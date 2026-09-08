import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { OrderStatus, Prisma, StockMovementReason, type ProductStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { defaultBranchId } from './inventory.service.js';
import { computeOrderTotals, getTaxRate } from './order-math.service.js';
import { getSettingValue } from './settings.service.js';

/**
 * The till's own reads (O5).
 *
 * ─── WHY A SCAN IS NOT THE SEARCH ENDPOINT ───────────────────────────
 * `/search` and the product list both answer "show me things that might
 * match". A scan is the opposite question: this exact code is in my hand, give
 * me the one product it belongs to, or tell me plainly that nothing has it.
 * Routing a scan through fuzzy search means a mistyped digit silently adds a
 * DIFFERENT product to the basket, which is the worst outcome at a till — the
 * customer is charged for something they are not holding.
 *
 * So: exact match only, on `barcode` (globally unique) then `sku`.
 */

export interface ScannedProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Unit price as a 2dp string — money never crosses this boundary as a
   *  float, the same rule as everywhere else in this codebase. */
  price: string;
  /** Stock AT THE BRANCH the till is standing in, not the all-branch total.
   *  Null when no branch is in context, which the caller must distinguish
   *  from a real zero. */
  branchStock: number | null;
  /** The all-branch figure, so a cashier can say "we have none here, the
   *  warehouse has twelve" rather than just "no". */
  totalStock: number;
  /**
   * DRAFT / ACTIVE / ARCHIVED. Returned rather than filtered on, so the till
   * decides what to do: a DRAFT product physically on the shelf still has to
   * be sellable, and hiding it would leave a cashier holding an item the
   * system claims not to know.
   */
  status: ProductStatus;
}

/**
 * Find the one product carrying this code.
 *
 * `barcode` first because it is what a scanner emits and it is globally
 * unique; `sku` second for a shop whose own codes are printed on the shelf
 * label. Both are exact — see the note above.
 */
export async function scanProduct(
  code: string,
  branchId: string | null,
): Promise<ScannedProduct> {
  const trimmed = code.trim();

  if (trimmed === '') {
    throw AppError.badRequest('Scan or type a code', { field: 'code' });
  }

  const product = await prisma.product.findFirst({
    where: { OR: [{ barcode: trimmed }, { sku: trimmed }] },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      price: true,
      stock: true,
      status: true,
    },
  });

  if (!product) {
    // The code is echoed back deliberately: at a till the usual cause is a
    // mis-scan, and seeing what was actually read is how somebody notices a
    // digit was dropped.
    throw AppError.notFound(`No product has the code ${trimmed}`);
  }

  const branchStock =
    branchId === null
      ? null
      : ((
          await prisma.branchStock.findUnique({
            where: { productId_branchId: { productId: product.id, branchId } },
            select: { quantity: true },
          })
        )?.quantity ?? 0);

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    price: product.price.toFixed(2),
    branchStock,
    totalStock: product.stock,
    status: product.status,
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * BROWSE (O9.10)
 *
 * The scan field answers "this exact code is in my hand". This answers a
 * different question: "which product is this, on a shelf with no barcode?"
 * Counted against the live catalogue when this was built: 30 products, 1
 * barcode — for the other 29 a cashier had no way to sell them except typing
 * an exact SKU from memory. The owner confirmed the shop will not be
 * barcoding its stock, which makes this the PRIMARY way a cashier finds a
 * product, and the scan field a secondary path for the items that do carry
 * a code.
 *
 * Deliberately a SEPARATE function from scanProduct, not a shared one with a
 * "fuzzy" flag — the scan's exactness is a correctness property (a mistyped
 * digit must never silently resolve to a different product), and mixing it
 * into the same code path as a browsable, paginated, search-matched list is
 * how that property quietly grows an escape hatch.
 * ───────────────────────────────────────────────────────────────────── */

export interface BrowsedProduct {
  id: string;
  name: string;
  price: string;
  imageUrl: string | null;
  categoryId: string | null;
  /** Same meaning as `ScannedProduct.branchStock` — stock AT the till's
   *  branch, null when no branch is in context. */
  branchStock: number | null;
  status: ProductStatus;
}

export interface BrowseProductsParams {
  /** Free-text match on name — the till's own search, not `/search`'s
   *  cross-entity one, which also returns orders and customers a cashier
   *  building a cart has no use for. */
  q?: string | undefined;
  categoryId?: string | undefined;
  branchId: string | null;
}

/**
 * The grid a cashier taps instead of scanning.
 *
 * ARCHIVED products are excluded — unlike a scan, which must still surface an
 * archived product if it is physically scanned off a shelf (the cashier is
 * holding the thing regardless of its catalogue state), a browse is choosing
 * what to sell and an archived row has no business being offered.
 *
 * Capped rather than paginated: a till screen has room for a grid, not a
 * pager, and a shop with more than this many active products needs the
 * search box, not another page of tiles to scan by eye.
 */
const BROWSE_LIMIT = 60;

export async function browseProducts(
  params: BrowseProductsParams,
): Promise<BrowsedProduct[]> {
  const q = params.q?.trim();

  const products = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      ...(q ? { name: { contains: q } } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    },
    orderBy: { name: 'asc' },
    take: BROWSE_LIMIT,
    select: {
      id: true,
      name: true,
      price: true,
      imageUrl: true,
      categoryId: true,
      stock: true,
      status: true,
    },
  });

  // One query for every branch row, not one per product — the grid can hold
  // up to BROWSE_LIMIT tiles, and N+1 queries here would be the same mistake
  // the scan path avoids by design.
  const stockByProductId = new Map<string, number>();

  if (params.branchId !== null && products.length > 0) {
    const rows = await prisma.branchStock.findMany({
      where: { branchId: params.branchId, productId: { in: products.map((p) => p.id) } },
      select: { productId: true, quantity: true },
    });

    for (const row of rows) stockByProductId.set(row.productId, row.quantity);
  }

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: product.price.toFixed(2),
    imageUrl: product.imageUrl,
    categoryId: product.categoryId,
    // Missing row means the branch holds none of it — same reasoning as the
    // scan path's `?? 0` (see inventory.service.ts's comment on the same
    // question). Only meaningful when a branch is in context at all.
    branchStock: params.branchId === null ? null : (stockByProductId.get(product.id) ?? 0),
    status: product.status,
  }));
}

/** Active categories, for the grid's tabs. Excludes inactive ones the same
 *  way browseProducts excludes archived products — a tab for a category
 *  nobody may sell into is a dead end, not a filter. */
export async function browseCategories(): Promise<{ id: string; name: string }[]> {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/* ─────────────────────────────────────────────────────────────────────
 * CHECKOUT (O5.7, O5.8)
 *
 * The first thing in this app that creates an `Order` — until now
 * `prisma.order.create` existed only in tests and the seeder.
 * ───────────────────────────────────────────────────────────────────── */

export interface CheckoutLine {
  productId: string;
  quantity: number;
}

export interface CheckoutInput {
  lines: CheckoutLine[];
  /** 'cash' | 'card' | … — free text, mirroring `Order.paymentMethod`. */
  method: string;
  /** Cash handed over. Omitted for a card sale, where nothing is tendered. */
  tendered?: string | undefined;
  branchId?: string | undefined;
  /** The till session this belongs to, so the drawer can be reconciled. */
  /**
   * The till session this sale belongs to. **Resolved by the ROUTE from the
   * authenticated user's own open shift, never accepted from the request
   * body** (O9.17) — the drawer is reconciled by summing the payments that
   * carry a shift id, so a client-supplied one silently moves cash into
   * another cashier's count.
   */
  shiftId?: string | undefined;
  customerId?: string | undefined;
  note?: string | undefined;
}

/**
 * A human-readable, unique order number.
 *
 * Date-prefixed plus a random suffix rather than a sequential counter: a
 * counter needs its own row and a lock, and two tills selling at once would
 * serialise behind it. The suffix is drawn from a 32-character alphabet, so a
 * collision inside one day is vanishingly unlikely — and if one ever happens
 * the `@unique` constraint rejects it rather than overwriting a real sale.
 */
function generateOrderNumber(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(4).toString('hex').toUpperCase();

  return `POS-${today}-${suffix}`;
}

/**
 * Take a sale.
 *
 * ─── EVERYTHING COMMITS TOGETHER ─────────────────────────────────────
 * The order, its lines, the stock movements and the payment are one
 * transaction. A sale that recorded the money but not the stock — or the
 * reverse — leaves books and shelves disagreeing with nothing to say which
 * half happened, and at a till that is exactly what a dropped connection
 * mid-payment produces.
 *
 * ─── PRICE *AND* COST ARE SNAPSHOTTED ────────────────────────────────
 * The F1.1 rule: any figure describing a past event reads a snapshot, never a
 * live lookup. `OrderItem.cost` exists because margin reporting was once
 * joining `products.cost` LIVE, so a supplier price change silently rewrote
 * the profit on every past order. A checkout setting only `price` would
 * reintroduce exactly that.
 *
 * A product with no recorded cost stores NULL, never 0 — "not recorded" is a
 * real permanent state, and a fabricated zero reports the sale as pure profit.
 */
export async function checkout(input: CheckoutInput, actorId: string, req: Request) {
  if (input.lines.length === 0) {
    throw AppError.badRequest('Add something to the sale first');
  }

  const productIds = [...new Set(input.lines.map((line) => line.productId))];

  if (productIds.length !== input.lines.length) {
    // Two lines for one product would each decrement stock separately and
    // print twice on the receipt. Refused rather than silently summed — the
    // same call bulk receive makes, for the same reason.
    throw AppError.badRequest('The same product is on more than one line');
  }

  const branchId = input.branchId ?? (await defaultBranchId());
  const taxRate = await getTaxRate();
  const allowNegative = Boolean(await getSettingValue('inventory.allowNegativeStock'));

  const created = await prisma.$transaction(async (tx) => {
    // Read INSIDE the transaction: the price that goes on the receipt must be
    // the price at the moment of sale, not one fetched before the customer
    // reached the counter.
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true, cost: true },
    });

    const byId = new Map(products.map((product) => [product.id, product]));

    const branchRows = await tx.branchStock.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    });

    const stockById = new Map(branchRows.map((row) => [row.productId, row.quantity]));

    const priced = input.lines.map((line) => {
      const product = byId.get(line.productId);

      if (!product) throw AppError.badRequest('Product not found', { field: 'productId' });

      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw AppError.badRequest('Quantity must be a whole number above zero', {
          field: 'quantity',
        });
      }

      const available = stockById.get(line.productId) ?? 0;

      if (!allowNegative && line.quantity > available) {
        /**
         * O5.8, decided: refuse by DEFAULT, overridable by a setting.
         *
         * Refusing suits a shop whose count is trusted — selling what is not
         * there produces a negative somebody has to explain, and the cashier
         * is standing at the shelf and can see the truth right now. But a shop
         * mid-stocktake, or one whose counts are known to lag, must not have
         * its till stop working over bookkeeping. Hence the setting, and hence
         * its default.
         */
        throw AppError.badRequest(
          `Only ${String(available)} of ${product.name} left at this branch`,
          { field: 'quantity', productId: line.productId, available },
        );
      }

      return {
        productId: line.productId,
        quantity: line.quantity,
        price: product.price,
        cost: product.cost,
      };
    });

    const totals = computeOrderTotals(priced, taxRate);

    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        status: OrderStatus.CONFIRMED,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        // Denormalised on purpose — every Reports/Dashboard revenue figure
        // reads THIS, never a recomputation.
        total: totals.total,
        paymentMethod: input.method,
        branchId,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        items: {
          create: priced.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            price: line.price,
            cost: line.cost,
          })),
        },
      },
      select: { id: true, orderNumber: true },
    });

    // Stock down, one SOLD movement per line, inside the same transaction.
    // Written directly rather than through `adjustStock` because that helper
    // opens its own transaction and fires a notification — nesting it here
    // would either deadlock or commit stock before the payment is recorded.
    // The three numbers F8.2 keeps in agreement are all updated below.
    for (const line of priced) {
      await tx.stockMovement.create({
        data: {
          productId: line.productId,
          branchId,
          delta: -line.quantity,
          reason: StockMovementReason.SOLD,
          actorId,
          note: `Sale ${order.orderNumber}`,
        },
      });

      await tx.branchStock.upsert({
        where: { productId_branchId: { productId: line.productId, branchId } },
        create: { productId: line.productId, branchId, quantity: -line.quantity },
        update: { quantity: { decrement: line.quantity } },
      });

      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.quantity } },
      });
    }

    const tendered = input.tendered === undefined ? null : new Prisma.Decimal(input.tendered);

    if (tendered !== null && tendered.lessThan(totals.total)) {
      throw AppError.badRequest('That is less than the total', { field: 'tendered' });
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        amount: totals.total,
        method: input.method,
        tendered,
        // Stored, not derived at read time — the drawer is reconciled against
        // what the cashier actually did (see `Payment`'s own note).
        change: tendered === null ? null : tendered.sub(totals.total),
        ...(input.shiftId ? { shiftId: input.shiftId } : {}),
        actorId,
        ...(input.note ? { note: input.note } : {}),
      },
      select: { id: true, change: true },
    });

    return { order, totals, payment, lineCount: priced.length };
  });

  audit(req, {
    action: 'order.sold',
    entity: 'orders',
    entityId: created.order.id,
    changes: {
      orderNumber: { from: null, to: created.order.orderNumber },
      total: { from: null, to: created.totals.total.toFixed(2) },
      method: { from: null, to: input.method },
      lines: { from: null, to: created.lineCount },
    },
  });

  return {
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
    subtotal: created.totals.subtotal.toFixed(2),
    taxAmount: created.totals.taxAmount.toFixed(2),
    total: created.totals.total.toFixed(2),
    change: created.payment.change?.toFixed(2) ?? null,
  };
}
