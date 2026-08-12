import { Prisma, type StockMovementReason } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
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
}

export async function listInventory(params: InventoryListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const threshold = await resolveThreshold(params.threshold);

  const where: Prisma.ProductWhereInput = {
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search } },
            { sku: { contains: params.search } },
          ],
        }
      : {}),
    ...(params.lowStock ? { stock: { lte: threshold } } : {}),
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
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products: rows.map((row) => ({ ...row, isLow: row.stock <= threshold })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    threshold,
  };
}

export async function listMovements(
  productId: string,
  params: { page?: number; pageSize?: number } = {},
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
      where: { productId },
      // Newest first: the recent change is what someone is checking.
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        delta: true,
        reason: true,
        note: true,
        actorId: true,
        createdAt: true,
      },
    }),
    prisma.stockMovement.count({ where: { productId } }),
  ]);

  /**
   * `actorId` is a plain id, not a relation (see the schema comment — the
   * trail must survive the staff member being deleted, same reasoning as
   * `OrderStatusHistory.changedById`). Names are resolved here, batched, at
   * READ time rather than snapshotted at write time the way the audit
   * trail's `actorEmail`/`actorRole` are: this is a display convenience, not
   * evidence, so "Unknown" for a deleted account is an acceptable trade
   * against a schema change B4.3 doesn't otherwise need.
   */
  const actorIds = [...new Set(movements.map((m) => m.actorId).filter((id): id is string => id !== null))];
  const actors =
    actorIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
      : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name ?? actor.email]));

  return {
    product,
    movements: movements.map((movement) => ({
      ...movement,
      actorName: movement.actorId ? (actorNames.get(movement.actorId) ?? null) : null,
      createdAt: movement.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface AdjustStockInput {
  delta: number;
  reason: StockMovementReason;
  note?: string | undefined;
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
export async function adjustStock(productId: string, input: AdjustStockInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw AppError.badRequest('Enter a whole number that is not zero', {
      field: 'delta',
    });
  }

  // Read outside the transaction: this only decides whether to fire a
  // best-effort notification afterwards, not anything the transaction's
  // correctness depends on.
  const threshold = await resolveThreshold(undefined);

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true },
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
        delta: input.delta,
        reason: input.reason,
        note: input.note ?? null,
        actorId: input.actorId,
      },
      select: {
        id: true,
        delta: true,
        reason: true,
        note: true,
        actorId: true,
        createdAt: true,
      },
    });

    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: next },
      select: { id: true, name: true, sku: true, stock: true },
    });

    return {
      product: updated,
      movement: { ...movement, createdAt: movement.createdAt.toISOString() },
      // Crossing INTO low stock, not merely being low — otherwise every
      // further movement on an already-low product renotifies, and the one
      // crossing that mattered disappears into that noise.
      crossedIntoLowStock: product.stock > threshold && next <= threshold,
    };
  });

  if (result.crossedIntoLowStock && (await getSettingValue('notifications.lowStockAlerts'))) {
    notify({
      type: 'inventory.low-stock',
      title: result.product.name,
      body: `${String(result.product.stock)} left — at or below the threshold of ${String(threshold)}.`,
      link: '/admin/inventory',
    });
  }

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
