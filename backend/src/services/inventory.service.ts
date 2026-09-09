import { Prisma, type StockMovementReason } from '@prisma/client';
import type { Request } from 'express';
import { resolveBranchLabels } from './branches.service.js';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { getSettingValue } from './settings.service.js';
import { notify } from './notify.service.js';

/**
 * Stock as a movement log, not a number you overwrite.
 *
 * ─── WHY A LOG AND NOT A FIELD ───────────────────────────────────────
 * "Set stock to 47" answers nothing when the count is wrong next week. A log
 * of "+50 received", "−3 damaged" carries WHO, WHEN and WHY, so a discrepancy
 * is investigable rather than a mystery. Every movement requires a reason for
 * exactly that purpose — an unexplained adjustment is indistinguishable from a
 * mistake once the person who made it has moved on.
 *
 * ─── TWO COPIES, ONE TRANSACTION ─────────────────────────────────────
 * The movements are the truth. `product.stock` is a denormalised running total
 * so a product list doesn't have to sum a table per row. Both are written in
 * one transaction, so they cannot disagree — and `reconcile()` proves it
 * rather than assuming it.
 *
 * The log is APPEND-ONLY. There is no edit or delete path: a wrong movement is
 * corrected by a compensating CORRECTION movement, so the trail records what
 * actually happened, including the mistake.
 */

const MAX_PAGE_SIZE = 100;

/**
 * Mirrors `inventory.lowStockThreshold`'s declared default in
 * `settings.config.ts` — kept as its own constant only so tests here assert
 * against a named value instead of a magic `5`. The LIVE threshold comes from
 * the setting itself (see `resolveThreshold` below), never this constant
 * directly, so an admin changing the setting takes effect everywhere at once.
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** An explicit `?threshold=` always wins; otherwise the live setting applies. */
async function resolveThreshold(explicit: number | undefined): Promise<number> {
  return explicit ?? (await getSettingValue('inventory.lowStockThreshold'));
}

export interface InventoryListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  lowStock?: boolean;
  threshold?: number;
  /**
   * Show one branch's stock instead of the all-branch total (F8).
   *
   * This changes the NUMBER, not just which rows appear — which is what makes
   * it different from every other filter here. `Product.stock` is the total
   * across every branch; scoped, each row reports that branch's own
   * `BranchStock.quantity`, and "low" is judged against THAT.
   *
   * Omitted means every branch, exactly as before.
   */
  branchId?: string;
}

export async function listInventory(params: InventoryListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const threshold = await resolveThreshold(params.threshold);

  const where: Prisma.ProductWhereInput = {
    // AND, not two sibling ORs: search and low-stock BOTH want an OR at this
    // level, and spreading them side by side would silently let the second
    // overwrite the first — the search would stop applying whenever the
    // low-stock filter was on.
    AND: [
      ...(params.search
        ? [
            {
              OR: [
                { name: { contains: params.search } },
                { sku: { contains: params.search } },
              ],
            },
          ]
        : []),
    /**
     * Low stock, per product (F7.8).
     *
     * A product may override the store-wide threshold — a cafe cannot use one
     * number for both espresso beans and espresso machines. So "low" is
     * either `stock <= its own threshold` (when it has one) or
     * `stock <= the store default` (when it does not).
     *
     * Expressed as an OR rather than a raw query so it stays composable with
     * the search filter above and with Prisma's own pagination; the
     * `lowStockThreshold: null` half is what makes the two branches exclusive
     * rather than double-counting a product that has an override.
     */
      ...(params.lowStock
        ? [
            {
              OR: [
                { lowStockThreshold: null, stock: { lte: threshold } },
                {
                  lowStockThreshold: { not: null },
                  // Column-to-column comparison: `stock <= low_stock_threshold`
                  // on the same row, which is the whole point of a per-product
                  // override.
                  stock: { lte: prisma.product.fields.lowStockThreshold },
                },
              ],
            },
          ]
        : []),
    ],
  };

  // One transaction so the count cannot disagree with the page it describes.
  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      // Lowest stock first when filtering for problems — the whole point of the
      // view is to surface what needs attention, not to browse alphabetically.
      orderBy: params.lowStock ? { stock: 'asc' } : { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        status: true,
        imageUrl: true,
        lowStockThreshold: true,
        storageLocation: true,
        // Surfaced so the list can flag "no cost recorded" (F1.4b). Profit
        // reporting excludes uncosted lines entirely, so a product nobody has
        // priced is silently absent from margin — this is where that becomes
        // visible and fixable.
        cost: true,
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  /**
   * Scoped to a branch, `stock` is that branch's quantity — not the
   * all-branch total the column holds.
   *
   * Fetched per page rather than joined into the query above because the
   * low-stock WHERE clause compares `products.stock` column-to-column against
   * `low_stock_threshold`; swapping that for a joined value would mean
   * rewriting the filter as raw SQL and losing the composability the comment
   * above is about.
   *
   * The cost of that trade is stated plainly: with a branch active, the
   * low-stock FILTER still selects on the all-branch total while the BADGE
   * reports the branch's own. They can disagree, so `isLow` is recomputed
   * from the branch quantity below and the two are reconciled on the row
   * rather than left to contradict each other. A product filtered in on its
   * global total but not actually low at THIS branch shows without the badge,
   * which is the honest reading: it is in the list because it is low
   * somewhere.
   */
  const branchQuantities = params.branchId
    ? new Map(
        (
          await prisma.branchStock.findMany({
            where: { branchId: params.branchId, productId: { in: rows.map((r) => r.id) } },
            select: { productId: true, quantity: true },
          })
        ).map((r) => [r.productId, r.quantity]),
      )
    : null;

  return {
    products: rows.map((row) => {
      // No BranchStock row means this branch holds none of it: a real
      // measured zero, not a missing value.
      const stock = branchQuantities ? (branchQuantities.get(row.id) ?? 0) : row.stock;
      const effectiveThreshold = row.lowStockThreshold ?? threshold;

      return {
        ...row,
        stock,
        // Decimal → 2dp string; null stays null and means "not tracked", never 0.
        cost: row.cost === null ? null : row.cost.toFixed(2),
        // Per-row: the product's own threshold when it has one, the store
        // default otherwise. Judged against whichever stock figure this row
        // is actually reporting, so the badge never contradicts the number
        // printed beside it.
        isLow: stock <= effectiveThreshold,
        effectiveThreshold,
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    threshold,
  };
}

export async function listMovements(
  productId: string,
  /** `branchId` restricts the log to movements recorded AT that branch (F8) —
   *  a movement carries its own `branchId`, so this needs no join. */
  params: { page?: number; pageSize?: number; branchId?: string } = {},
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, sku: true, stock: true },
  });

  if (!product) throw AppError.notFound('Product not found');

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const [movements, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where: { productId, ...(params.branchId ? { branchId: params.branchId } : {}) },
      // Newest first: the recent change is what someone is checking.
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        delta: true,
        reason: true,
        note: true,
        unitCost: true,
        actorId: true,
        // O1: unscoped, the log mixes every branch's movements and two rows
        // for the same product are otherwise indistinguishable.
        branchId: true,
        // F7.8: the batch's own facts, so the log answers "where did this
        // stock come from and when did it land" without a second lookup.
        deliveredAt: true,
        purchasedAt: true,
        reference: true,
        supplier: { select: { id: true, name: true } },
        createdAt: true,
      },
    }),
    prisma.stockMovement.count({
      where: { productId, ...(params.branchId ? { branchId: params.branchId } : {}) },
    }),
  ]);

  const branches = await resolveBranchLabels(movements.map((movement) => movement.branchId));

  return {
    product,
    movements: movements.map((movement) => ({
      ...movement,
      branch: movement.branchId ? (branches.get(movement.branchId) ?? null) : null,
      deliveredAt: movement.deliveredAt?.toISOString() ?? null,
      purchasedAt: movement.purchasedAt?.toISOString() ?? null,
      // Decimal → string, deliberately: JSON.stringify would emit it
      // inconsistently and a float would lose the cents. Null stays null —
      // "not recorded" is not "0.00".
      unitCost: movement.unitCost === null ? null : movement.unitCost.toFixed(2),
      createdAt: movement.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * The branch to attribute a movement to when the caller does not name one.
 *
 * Reads the EXPLICIT `isDefault` flag, not "the oldest branch".
 *
 * Ordering by `createdAt` was the first attempt and it was wrong in a way that
 * only showed up with two branches: the seeded row is written by a migration
 * using MySQL's `NOW(3)` (the SERVER's local time) while Prisma writes real
 * UTC, so on a machine ahead of UTC the seeded branch sorted AFTER later ones.
 * Stock recorded without an explicit branch then landed at the wrong place,
 * silently. A flag cannot drift with a timezone.
 *
 * Throws rather than writing a null branch — a movement that belongs nowhere
 * cannot be reconciled against any branch's total, which is the one thing the
 * column exists to make possible.
 */
/** Exported for F6.1 — a shift needs the same "which branch when none is
 *  named" answer a stock movement does, and a second copy would be free to
 *  reintroduce the timezone bug F8.2 fixed. */
/**
 * The last-resort answer to "which branch" when a request carries none —
 * every caller uses it as `input.branchId ?? (await defaultBranchId())`, so
 * this only fires when nothing upstream (the branch switcher's header,
 * a return's own order, a bulk-receive batch) named one at all.
 *
 * ─── O9.18: WHY A SECOND BUSINESS MAKES THIS REFUSE, NOT GUESS ───────
 * `isDefault` is unique PER BUSINESS (see `branches.service.ts`'s
 * `clearOtherDefaults`), so a two-business install has TWO rows with
 * `isDefault: true` — one per business — and there is no principled way to
 * pick "the" default across companies from a request that named neither a
 * branch nor a business. The original version of this function used
 * `findFirst`, which returned whichever row the database handed back first:
 * deterministic-looking in a single-business dev/demo install (there was
 * only ever one row to find), but silently order-dependent the moment a
 * second business existed — exactly the bug F8.2 fixed for TWO DEFAULTS
 * WITHIN one business, now recurring one level up. Found live: this
 * project's own database carries 3 businesses, so the bug was not
 * hypothetical when it was found.
 *
 * The owner decided (2026-09-09): refuse with a clear error rather than
 * guess. A branch-less write on a single-business install still resolves
 * exactly as before — the ambiguity does not exist yet with one business,
 * so nothing there should start refusing. The moment a second business is
 * created, every branch-less request must become explicit about where it
 * belongs, rather than ever risk attributing stock, a sale, or a shift to
 * the wrong company.
 */
export async function defaultBranchId(): Promise<string> {
  const businessCount = await prisma.business.count();

  if (businessCount > 1) {
    throw AppError.badRequest(
      'Select a branch — this install has more than one business, so there is no single default to fall back to.',
    );
  }

  // Single business (or none yet, e.g. mid-setup): the flagged branch first,
  // any active branch only as a fallback for an install where the flag was
  // never set. Safe here specifically BECAUSE at most one business exists —
  // `isDefault` can carry at most one true row, so `findFirst` cannot be
  // order-dependent the way it was for 2+ businesses.
  const branch =
    (await prisma.branch.findFirst({
      where: { isActive: true, isDefault: true },
      select: { id: true },
    })) ??
    (await prisma.branch.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }));

  if (!branch) {
    throw AppError.badRequest('No active branch exists to record this movement against');
  }

  return branch.id;
}

export interface AdjustStockInput {
  delta: number;
  reason: StockMovementReason;
  note?: string | undefined;
  /**
   * Which branch this movement happened at (F8.2).
   *
   * Optional so every existing caller keeps working — an install with one
   * branch should not have to name it. Resolved to the default branch when
   * omitted, rather than left null, or the per-branch total would drift away
   * from the movement log the moment anyone used the old call shape.
   */
  branchId?: string | undefined;
  /**
   * Per-unit acquisition cost for THIS batch (F1.4a), as a decimal string —
   * money never crosses a boundary as a float in this codebase.
   *
   * Undefined means "not recorded", which is a real and permanent state, not
   * a zero. The route refuses it outright on an outgoing movement, so by the
   * time it arrives here it is already known to belong.
   */
  unitCost?: string | undefined;
  /**
   * Batch detail (F7.8) — properties of THIS delivery, not of the product.
   *
   * The owner's case: fifty units arrive, their details are entered once. A
   * receipt is already ONE movement row, so the batch's facts live on it,
   * beside `unitCost`. On `Product` they could only ever hold the most recent
   * delivery, silently overwriting the history this log exists to keep.
   *
   * The route refuses all four on an outgoing movement, so by the time they
   * arrive here they are already known to belong.
   */
  deliveredAt?: string | undefined;
  purchasedAt?: string | undefined;
  reference?: string | undefined;
  supplierId?: string | undefined;
  actorId: string;
}

/**
 * Record a stock movement and move the running total with it.
 *
 * ─── WHY THE READ IS INSIDE THE TRANSACTION ──────────────────────────
 * Reading stock, deciding, then writing would let two concurrent adjustments
 * both read 3, both subtract 2, and leave 1 instead of −1 rejected. The read
 * and the write happen in the same transaction so the negative-stock check is
 * made against a value that cannot have moved underneath it.
 */
export async function adjustStock(productId: string, input: AdjustStockInput, req: Request) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw AppError.badRequest('Enter a whole number that is not zero', {
      field: 'delta',
    });
  }

  // Read outside the transaction: this only decides whether to fire a
  // best-effort notification afterwards, not anything the transaction's
  // correctness depends on.
  const threshold = await resolveThreshold(undefined);

  // Resolved before the transaction: it is a lookup, not something the
  // transaction's correctness depends on.
  const branchId = input.branchId ?? (await defaultBranchId());

  // Checked here rather than left to the foreign key: a bad id would
  // otherwise surface as a raw Prisma FK violation — a 500 naming a
  // constraint, which tells whoever is receiving stock nothing about which
  // field to fix.
  if (input.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true },
    });

    if (!supplier) {
      throw AppError.badRequest('Supplier not found', { field: 'supplierId' });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true, lowStockThreshold: true },
    });

    if (!product) throw AppError.notFound('Product not found');

    const next = product.stock + input.delta;

    if (next < 0) {
      // Refusing names the numbers, so the caller can see what would have
      // worked instead of guessing at the limit.
      throw AppError.badRequest(
        `Only ${product.stock} in stock — that would leave ${next}`,
        { field: 'delta', available: product.stock },
      );
    }

    const movement = await tx.stockMovement.create({
      data: {
        productId,
        branchId,
        delta: input.delta,
        reason: input.reason,
        note: input.note ?? null,
        // `new Prisma.Decimal(string)` — never a float. Undefined stays NULL,
        // which means "not recorded" and is distinct from a recorded 0.
        unitCost: input.unitCost === undefined ? null : new Prisma.Decimal(input.unitCost),
        deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
        reference: input.reference ?? null,
        supplierId: input.supplierId ?? null,
        actorId: input.actorId,
      },
      select: {
        id: true,
        delta: true,
        reason: true,
        note: true,
        unitCost: true,
        actorId: true,
        createdAt: true,
      },
    });

    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: next },
      select: { id: true, name: true, sku: true, stock: true },
    });

    /**
     * The per-branch total moves in the SAME transaction as the movement and
     * the product total (F8.2). Three numbers, one write — if the branch
     * total were updated separately it could survive a rolled-back movement
     * and start claiming stock that was never received.
     *
     * `upsert` because a product may have no row for this branch yet: a
     * branch opened after the product existed, or the first delivery of that
     * item to that location. The unique constraint on (product, branch) is
     * what makes it safe under concurrent adjustments.
     */
    await tx.branchStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity: input.delta },
      update: { quantity: { increment: input.delta } },
    });

    return {
      product: updated,
      movement: {
        ...movement,
        unitCost: movement.unitCost === null ? null : movement.unitCost.toFixed(2),
        createdAt: movement.createdAt.toISOString(),
      },
      // Crossing INTO low stock, not merely being low — otherwise every
      // further movement on an already-low product renotifies, and the one
      // crossing that mattered disappears into that noise.
      // The product's own threshold decides, so a bespoke limit actually
      // fires the alert rather than being a number nothing reads.
      crossedIntoLowStock:
        product.stock > (product.lowStockThreshold ?? threshold) &&
        next <= (product.lowStockThreshold ?? threshold),
      effectiveThreshold: product.lowStockThreshold ?? threshold,
    };
  });

  if (result.crossedIntoLowStock && (await getSettingValue('notifications.lowStockAlerts'))) {
    notify({
      type: 'inventory.low-stock',
      title: result.product.name,
      body: `${String(result.product.stock)} left — at or below the threshold of ${String(result.effectiveThreshold)}.`,
      link: '/admin/inventory',
    });
  }

  /**
   * The stock movement reaches the AUDIT TRAIL too (F6.2), not just its own
   * log.
   *
   * `StockMovement.actorId` already recorded who moved stock, so the fact was
   * never lost — but it was only visible by opening that one product's
   * movement log. It did not appear in `/admin/audit`, and
   * `getStaffActivity` did not count it, so "what did this person do today"
   * silently omitted counting stock, which for a shift worker is most of the
   * job.
   *
   * Written AFTER the transaction commits, deliberately: an audit entry for a
   * movement that then rolled back would be a record of something that never
   * happened. `audit()` is best-effort and never throws (see its own note),
   * so a logging outage cannot fail an adjustment that already succeeded.
   *
   * `resultingStock` is included because the delta alone is not reviewable —
   * "−3" raises "from what?", and the answer is otherwise a second query.
   */
  audit(req, {
    action: 'inventory.stock.adjusted',
    entity: 'product',
    entityId: result.product.id,
    changes: {
      stock: { from: result.product.stock - result.movement.delta, to: result.product.stock },
      delta: { to: result.movement.delta },
      reason: { to: result.movement.reason },
      note: { to: result.movement.note },
      // What the batch cost, where it was recorded (F1.4a) — a price paid is
      // exactly the kind of fact a reviewer asks about later.
      unitCost: { to: result.movement.unitCost },
      movementId: { to: result.movement.id },
    },
  });

  return { product: result.product, movement: result.movement };
}

/**
 * Does the log still agree with the running total?
 *
 * The two are written together, so they should never diverge — but "should
 * never" is worth checking rather than trusting, because a direct DB edit or a
 * future code path that updates `stock` without a movement would drift
 * silently and the log would stop being an explanation of the number.
 */
export async function reconcile(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, stock: true },
  });

  if (!product) throw AppError.notFound('Product not found');

  const sum = await prisma.stockMovement.aggregate({
    where: { productId },
    _sum: { delta: true },
  });

  const fromMovements = sum._sum.delta ?? 0;

  return {
    productId,
    stock: product.stock,
    fromMovements,
    /** False means something wrote `stock` without recording why. */
    agrees: product.stock === fromMovements,
  };
}
