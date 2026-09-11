import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import {
  OrderStatus,
  Prisma,
  ReturnResolution,
  StockMovementReason,
  type ProductStatus,
} from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { verifyOverrideToken } from './auth.service.js';
import { defaultBranchId } from './inventory.service.js';
import { executeIdempotently } from './idempotency.service.js';
import { normalizePhone } from '../lib/phone.js';
import { computeOrderTotals, getTaxRate } from './order-math.service.js';
import { getSettingValue } from './settings.service.js';
import { resolveTenderRate } from './tender-currency.service.js';
import {
  localizeProductRows,
  type ProductLocale,
} from './product-content.service.js';

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
  locale: ProductLocale = 'en',
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

  const localized = (await localizeProductRows([product], locale))[0]!;

  return {
    id: product.id,
    name: String(localized.name),
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
  /** Resuming a parked cart (O9.12b) — fetch exactly these ids' CURRENT price
   *  and stock rather than what was parked. A product archived since it was
   *  set aside is silently absent from the result, the same as it would be
   *  from an ordinary browse — nothing here re-sells something no longer
   *  sellable. */
  ids?: string[] | undefined;
  locale?: ProductLocale | undefined;
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
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              ...(params.locale === 'ar'
                ? [{ translations: { some: { locale: 'ar', name: { contains: q } } } }]
                : []),
            ],
          }
        : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.ids && params.ids.length > 0 ? { id: { in: params.ids } } : {}),
    },
    orderBy: { name: 'asc' },
    // A resume asks for a specific id list, which may legitimately exceed the
    // grid's own cap — capping it there would silently drop lines from a
    // cart that had more than BROWSE_LIMIT distinct products in it.
    take: params.ids && params.ids.length > 0 ? undefined : BROWSE_LIMIT,
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

  const localized = await localizeProductRows(products, params.locale ?? 'en');

  return localized.map((product) => ({
    id: product.id,
    name: product.name,
    price: (product.price as { toFixed: (digits: number) => string }).toFixed(2),
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
  /** A cashier's ad-hoc discount on THIS line (O9 Tier 3), 0-100. Above
   *  `pos.maxCashierDiscountPercent`, `overrideToken` on the whole checkout
   *  must verify to a manager or the sale is refused. */
  discountPercent?: number | undefined;
}

export interface CheckoutInput {
  lines: CheckoutLine[];
  /** 'cash' | 'card' | … — free text, mirroring `Order.paymentMethod`.
   *  Required UNLESS `splitPayments` is given instead — see its own note. */
  method?: string | undefined;
  /** Cash handed over, IN `tenderCurrency` when one is given. Omitted for a
   *  card sale, where nothing is tendered. */
  tendered?: string | undefined;
  /** What the customer paid in. Absent means the store's own currency. */
  tenderCurrency?: string | undefined;
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
  /** The card terminal's own reference — see the schema comment on
   *  `Payment.reference`. Optional; cash never has one. */
  reference?: string | undefined;
  /**
   * Proof a manager approved a discount above the cap (O9.13, O9 Tier 3) —
   * a SIGNED token from `POST /auth/manager-override`, verified here with
   * `verifyOverrideToken`, never a client-supplied approver id taken on
   * faith. Absent when every line's discount is within the cap; required
   * (and re-verified server-side) otherwise.
   */
  overrideToken?: string | undefined;
  /**
   * Split payment (O9 Tier 3) — 30 cash, rest on card, and so on. When
   * present, this REPLACES `method`/`tendered` entirely rather than the two
   * combining; a sale is either single-method or split, never a mix of
   * both shapes read together. Each entry becomes its OWN `Payment` row —
   * exactly why `Payment` was built as a table rather than columns on
   * `Order` in the first place (O5.2). Amounts must sum to the total
   * exactly; a split that leaves a gap or overshoots is refused, not
   * silently rounded.
   */
  splitPayments?: SplitPaymentInput[] | undefined;
  /**
   * Exchange (O9.8) — two linked records, not one combined transaction (the
   * owner's own call). The return itself already happened, processed like
   * any other (refund/restock, resolution REPLACEMENT); this is an
   * otherwise-ORDINARY sale that also links back to it, so the return's
   * history shows what it was traded for. Validated: the return must exist,
   * carry `resolution: REPLACEMENT`, and not already be linked to a
   * different sale — a second checkout naming the same return would silently
   * steal the link from the first.
   */
  exchangeReturnId?: string | undefined;
}

export interface SplitPaymentInput {
  method: string;
  /** What THIS payment covers — not the sale's total. */
  amount: string;
  /** Only meaningful when `method` is cash; change is computed per-entry,
   *  same as the single-payment path. */
  tendered?: string | undefined;
  reference?: string | undefined;
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
async function checkoutOnce(
  input: CheckoutInput,
  actorId: string,
  tx: Prisma.TransactionClient,
) {
  if (input.lines.length === 0) {
    throw AppError.badRequest('Add something to the sale first');
  }

  // Exactly one shape, never both read together — a `method` alongside
  // `splitPayments` would leave "which one is the real payment" ambiguous,
  // and silently preferring one would make the other look accepted when it
  // was quietly ignored.
  const isSplit = input.splitPayments !== undefined;

  if (isSplit && input.method !== undefined) {
    throw AppError.badRequest('Send either method or splitPayments, not both', {
      field: 'method',
    });
  }

  if (!isSplit && input.method === undefined) {
    throw AppError.badRequest('A payment method is required', { field: 'method' });
  }

  if (isSplit && (input.splitPayments?.length ?? 0) < 2) {
    // One entry is not a split — it is the single-payment path wearing the
    // split shape for no reason, and it would skip the single-payment
    // route's own validation (e.g. `tendered` less than the total) if let
    // through as one payment of the whole amount.
    throw AppError.badRequest('A split needs at least two payments', {
      field: 'splitPayments',
    });
  }

  const productIds = [...new Set(input.lines.map((line) => line.productId))];

  if (productIds.length !== input.lines.length) {
    // Two lines for one product would each decrement stock separately and
    // print twice on the receipt. Refused rather than silently summed — the
    // same call bulk receive makes, for the same reason.
    throw AppError.badRequest('The same product is on more than one line');
  }

  const branchId = input.branchId ?? (await defaultBranchId());

  if (input.customerId) {
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    });
    if (!customer) {
      throw AppError.badRequest('The selected customer no longer exists', {
        field: 'customerId',
      });
    }
  }

  const taxRate = await getTaxRate();
  const allowNegative = Boolean(await getSettingValue('inventory.allowNegativeStock'));

  /**
   * Discounts (O9 Tier 3).
   *
   * Validated and the cap resolved BEFORE the transaction — neither needs a
   * lock, and refusing early means a bad discount never gets as far as
   * touching stock.
   */
  const maxCashierDiscountPercent = Number(
    await getSettingValue('pos.maxCashierDiscountPercent'),
  );

  let approverId: string | null = null;

  for (const line of input.lines) {
    const percent = line.discountPercent;
    if (percent === undefined) continue;

    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw AppError.badRequest('Discount must be between 0 and 100', {
        field: 'discountPercent',
        productId: line.productId,
      });
    }

    if (percent > maxCashierDiscountPercent) {
      // Resolved ONCE, lazily, the first time a line actually needs it —
      // most sales carry no discount at all, and most that do stay under
      // the cap. Verifying a token that was never sent would be verifying
      // `undefined`, which `verifyOverrideToken` would correctly reject
      // anyway, but resolving it lazily keeps the common path free of a
      // JWT verify it does not need.
      if (approverId === null) {
        if (!input.overrideToken) {
          throw AppError.forbidden(
            `A discount above ${String(maxCashierDiscountPercent)}% needs a manager's approval`,
            { field: 'discountPercent', productId: line.productId },
          );
        }

        const verified = verifyOverrideToken(input.overrideToken);

        if (!verified) {
          // Same generic shape as every other "your proof did not check
          // out" refusal in this app — a stale or forged token gets the
          // same answer as none at all, not a hint about which was wrong.
          throw AppError.forbidden('The manager approval could not be verified');
        }

        approverId = verified;
      }
    }
  }

  // Exchange (O9.8) — validated before the transaction, same reasoning as
  // discounts above: a bad return id must never get as far as touching
  // stock.
  if (input.exchangeReturnId) {
    const linkedReturn = await tx.return.findUnique({
      where: { id: input.exchangeReturnId },
      select: { id: true, resolution: true, exchangeOrderId: true },
    });

    if (!linkedReturn) {
      throw AppError.notFound('The return this sale is meant to replace was not found');
    }

    if (linkedReturn.resolution !== ReturnResolution.REPLACEMENT) {
      throw AppError.badRequest(
        'That return was not resolved as a replacement, so it cannot be linked to a sale',
        { field: 'exchangeReturnId' },
      );
    }

    if (linkedReturn.exchangeOrderId) {
      // Second checkout naming the same return — refused rather than
      // silently re-pointing the link, which would make the FIRST sale
      // look like it was never actually the replacement.
      throw AppError.badRequest('That return is already linked to a sale', {
        field: 'exchangeReturnId',
      });
    }
  }

  /**
   * Resolved BEFORE the transaction, and only when a currency was named.
   *
   * It reads settings, which is its own query — doing that inside the write
   * transaction would hold row locks open across an unrelated read for every
   * sale, including the overwhelming majority paid in the store's own
   * currency. An unaccepted code throws here, before anything is written.
   */
  const tenderInfo = input.tenderCurrency
    ? await resolveTenderRate(input.tenderCurrency)
    : null;

  const created = await (async () => {
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
         *
         * This read-based check is the FRIENDLY refusal — it names the product
         * and the real remaining count, which the atomic guard at the
         * decrement below cannot do as helpfully. It is not the safety
         * boundary: see the conditional decrement for why.
         */
        throw AppError.badRequest(
          `Only ${String(available)} of ${product.name} left at this branch`,
          { field: 'quantity', productId: line.productId, available },
        );
      }

      // The TRUE unit price, always — this is the snapshot every other
      // reader (margin reporting, the invoice, Reports/Dashboard revenue)
      // reads as "what this line's unit actually costs". Writing a
      // discounted figure in here would silently corrupt all of them; the
      // discount is a SEPARATE column precisely so `price` never has to
      // carry two meanings.
      const price = product.price;
      const discountPercent = line.discountPercent ?? null;

      // What `computeOrderTotals` actually charges tax and totals against —
      // a discount reduces what the customer owes, so it has to reach the
      // arithmetic somewhere, and `price` itself is the one place it must
      // NOT reach.
      const chargedPrice =
        discountPercent === null
          ? price
          : price.times(new Prisma.Decimal(100).minus(discountPercent)).dividedBy(100);

      return {
        productId: line.productId,
        quantity: line.quantity,
        price,
        chargedPrice,
        discountPercent,
        cost: product.cost,
      };
    });

    const totals = computeOrderTotals(
      priced.map((line) => ({ price: line.chargedPrice, quantity: line.quantity })),
      taxRate,
    );

    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        status: OrderStatus.CONFIRMED,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        // Denormalised on purpose — every Reports/Dashboard revenue figure
        // reads THIS, never a recomputation.
        total: totals.total,
        // 'split' is a real, distinct value here, not a fallback — a report
        // reading `paymentMethod` must be able to tell a split sale apart
        // from a single cash/card one rather than seeing an arbitrary first
        // method and assuming that is the whole story.
        paymentMethod: isSplit ? 'split' : (input.method as string),
        branchId,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        items: {
          create: priced.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            price: line.price,
            cost: line.cost,
            discountPercent: line.discountPercent,
          })),
        },
      },
      select: { id: true, orderNumber: true },
    });

    // Exchange (O9.8) — link the return to THIS sale now that it exists.
    // `@unique` on `exchangeOrderId` means a second attempt to link the same
    // order to a different return would fail here rather than silently
    // pointing two returns at one sale.
    if (input.exchangeReturnId) {
      await tx.return.update({
        where: { id: input.exchangeReturnId },
        data: { exchangeOrderId: order.id },
      });
    }

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

      /**
       * URG-005 — the real oversell boundary.
       *
       * The read-based check above cannot hold: this transaction runs at
       * MySQL's default REPEATABLE READ (see `executeIdempotently`), so two
       * cashiers selling the last unit each read `available = 1`, each pass
       * that check, and each reach this decrement. `@@unique([productId,
       * branchId])` constrains the row's IDENTITY, not its VALUE, so an
       * unconditional `decrement` commits both and the shelf goes to -1.
       *
       * Putting the quantity condition in the WHERE clause makes the check and
       * the write one atomic statement — the same TOCTOU-closing shape the
       * password-reset redemption uses. The loser updates 0 rows and is
       * refused, so the units cannot be sold twice.
       *
       * Serializable isolation was rejected: it would serialize every sale,
       * including the overwhelming majority that never contend for one row,
       * and add deadlock retries across the whole checkout to fix a conflict
       * that belongs to a single row.
       */
      if (allowNegative) {
        // The deliberate mid-stocktake escape hatch (O5.8) — counts are known
        // to lag here, so going negative is the accepted outcome, not a race.
        await tx.branchStock.upsert({
          where: { productId_branchId: { productId: line.productId, branchId } },
          create: { productId: line.productId, branchId, quantity: -line.quantity },
          update: { quantity: { decrement: line.quantity } },
        });
      } else {
        const claimed = await tx.branchStock.updateMany({
          where: {
            productId: line.productId,
            branchId,
            // The whole point: only decrement if the units are still there.
            quantity: { gte: line.quantity },
          },
          data: { quantity: { decrement: line.quantity } },
        });

        if (claimed.count === 0) {
          // Either another sale took the units between the read above and
          // here, or this product has no stock row at this branch at all.
          // Both mean the same thing to the cashier: it is not on the shelf.
          const current = await tx.branchStock.findUnique({
            where: { productId_branchId: { productId: line.productId, branchId } },
            select: { quantity: true },
          });
          const remaining = current?.quantity ?? 0;

          throw AppError.badRequest(
            `Only ${String(remaining)} of ${byId.get(line.productId)?.name ?? 'that product'} left at this branch`,
            { field: 'quantity', productId: line.productId, available: remaining },
          );
        }
      }

      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.quantity } },
      });
    }

    let totalChange: Prisma.Decimal | null = null;

    if (isSplit) {
      const entries = input.splitPayments ?? [];
      const amounts = entries.map((entry) => new Prisma.Decimal(entry.amount));
      const sum = amounts.reduce((total, amount) => total.plus(amount), new Prisma.Decimal(0));

      // Exact, not "close enough" — a split that leaves a gap is a sale
      // nobody actually paid for in full, and one that overshoots is a
      // refund nobody recorded as one. Both are wrong in ways the till must
      // catch here, not leave for someone reconciling the drawer to find.
      if (!sum.equals(totals.total)) {
        throw AppError.badRequest(
          `Split payments total ${sum.toFixed(2)}, which does not match the sale total ${totals.total.toFixed(2)}`,
          { field: 'splitPayments' },
        );
      }

      for (const entry of entries) {
        const amount = new Prisma.Decimal(entry.amount);
        const entryTendered =
          entry.tendered === undefined ? null : new Prisma.Decimal(entry.tendered);

        if (entryTendered !== null && entryTendered.lessThan(amount)) {
          throw AppError.badRequest('That is less than this payment', {
            field: 'splitPayments',
          });
        }

        const change = entryTendered === null ? null : entryTendered.sub(amount);
        // Only cash ever hands back change; summing null with a real
        // Decimal would need its own case, and a split with no cash leg at
        // all correctly reports no change to give.
        if (change !== null) totalChange = (totalChange ?? new Prisma.Decimal(0)).plus(change);

        await tx.payment.create({
          data: {
            orderId: order.id,
            amount,
            method: entry.method,
            tendered: entryTendered,
            change,
            ...(input.shiftId ? { shiftId: input.shiftId } : {}),
            actorId,
            ...(input.note ? { note: input.note } : {}),
            ...(entry.reference ? { reference: entry.reference } : {}),
          },
        });
      }
    } else {
      const tendered = input.tendered === undefined ? null : new Prisma.Decimal(input.tendered);

      /**
       * The whole comparison happens in the TENDERED currency.
       *
       * `tenderDue` is the sale total expressed in what the customer is
       * handing over, so "is this enough?" and the change owed are both
       * answered in the notes actually on the counter. Comparing foreign cash
       * against a base-currency total would reject a correct payment (or
       * accept a short one) depending on which way the rate points.
       *
       * Change is given in the tendered currency by owner decision, which is
       * why `change` is stored in those units too — the drawer is counted per
       * currency at close.
       */
      const tenderDue = tenderInfo ? totals.total.mul(tenderInfo.rate).toDecimalPlaces(2) : totals.total;

      if (tendered !== null && tendered.lessThan(tenderDue)) {
        throw AppError.badRequest('That is less than the total', { field: 'tendered' });
      }

      totalChange = tendered === null ? null : tendered.sub(tenderDue);

      await tx.payment.create({
        data: {
          orderId: order.id,
          // Always the STORE currency, so every existing revenue, shift and
          // report query keeps summing one comparable unit.
          amount: totals.total,
          method: input.method as string,
          tendered,
          // Stored, not derived at read time — the drawer is reconciled
          // against what the cashier actually did (see `Payment`'s own
          // note).
          change: totalChange,
          ...(tenderInfo
            ? {
                tenderCurrency: tenderInfo.currency,
                tenderAmount: tenderDue,
                // Snapshotted: the receipt prints this rate, so re-deriving it
                // later would make a reprint disagree with the customer's copy.
                tenderRate: tenderInfo.rate,
              }
            : {}),
          ...(input.shiftId ? { shiftId: input.shiftId } : {}),
          actorId,
          ...(input.note ? { note: input.note } : {}),
          ...(input.reference ? { reference: input.reference } : {}),
        },
      });
    }

    return { order, totals, change: totalChange, lineCount: priced.length };
  })();

  return {
    result: {
      orderId: created.order.id,
      orderNumber: created.order.orderNumber,
      subtotal: created.totals.subtotal.toFixed(2),
      taxAmount: created.totals.taxAmount.toFixed(2),
      total: created.totals.total.toFixed(2),
      change: created.change?.toFixed(2) ?? null,
    },
    audit: {
      entityId: created.order.id,
      changes: {
      orderNumber: { from: null, to: created.order.orderNumber },
      total: { from: null, to: created.totals.total.toFixed(2) },
      method: { from: null, to: isSplit ? 'split' : input.method },
      lines: { from: null, to: created.lineCount },
      // Present only when a discount actually needed a manager — "who
      // approved this" is the whole question a reviewer asks of an
      // above-cap discount, the same reasoning the override endpoint's own
      // audit entry already follows.
      ...(approverId ? { discountApprovedBy: { from: null, to: approverId } } : {}),
    },
    },
  };
}

/** Minimal, purpose-built lookup for the till. Cashiers can associate a sale
 * without receiving the full customer-management surface or internal notes. */
export async function searchPosCustomers(query: string) {
  const normalizedPhone = normalizePhone(query);
  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { email: { contains: query } },
        { phone: { contains: query } },
        ...(normalizedPhone.length >= 2 ? [{ phoneNormalized: { contains: normalizedPhone } }] : []),
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
    take: 8,
  });
}

/**
 * Retry-safe checkout entry point.
 *
 * The idempotency claim and every checkout side effect share one database
 * transaction. A lost 201 response can therefore be retried with the same key
 * and returns the original receipt without moving money or stock twice.
 */
export async function checkout(
  input: CheckoutInput,
  actorId: string,
  req: Request,
  idempotencyKey: string,
) {
  // The shift is server state resolved from the signed-in actor on each HTTP
  // request, not part of what the client intended to submit. Excluding it
  // keeps an already-committed sale replayable if the cashier closes the shift
  // before retrying a response that was lost in transit.
  const { shiftId: _serverResolvedShiftId, ...requestIntent } = input;

  const execution = await executeIdempotently({
    scope: 'pos.checkout',
    actorId,
    key: idempotencyKey,
    request: requestIntent,
    execute: (tx) => checkoutOnce(input, actorId, tx),
  });

  // Audit only the execution that actually created the sale, and only after
  // the transaction committed. A replay is the same user action, not a second
  // sale event, and a rolled-back transaction must never leave a success log.
  if (!execution.replayed) {
    audit(req, {
      action: 'order.sold',
      entity: 'orders',
      entityId: execution.value.audit.entityId,
      changes: execution.value.audit.changes,
    });
  }

  return { value: execution.value.result, replayed: execution.replayed };
}

/* ─────────────────────────────────────────────────────────────────────
 * VOID (O9 Tier 3)
 *
 * Distinct from a return, on purpose: a return is a customer bringing
 * something back days later, needs a manager (O9.7), and lives in
 * `Return`/`returns.service.ts`. A void is the SAME sale, undone at the same
 * register, moments later, correcting a mistake — nobody ever actually had
 * the goods in the customer's understanding. So it never touches `Return` at
 * all; it reverses the three things checkout itself wrote: the order status,
 * the stock, and the payment.
 * ───────────────────────────────────────────────────────────────────── */

export async function voidSale(orderId: string, actorId: string, req: Request) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      branchId: true,
      items: { select: { productId: true, quantity: true } },
      payments: { select: { id: true, amount: true } },
    },
  });

  if (!order) throw AppError.notFound('Order not found');

  // Only CONFIRMED — the status a POS sale is created at and never moves
  // from unless something ELSE already happened to it. Once shipped,
  // delivered, cancelled or returned, undoing it is one of those other
  // flows' job, not a void's: a delivered order has physically left the
  // branch, and reversing stock for it would put units back on a shelf that
  // does not have them.
  if (order.status !== OrderStatus.CONFIRMED) {
    throw AppError.badRequest(
      `Only a CONFIRMED sale can be voided (this one is ${order.status})`,
      { field: 'status' },
    );
  }

  if (!order.branchId) {
    // A sale with no recorded branch cannot have its stock reversed
    // anywhere in particular — see `defaultBranchId()`'s own reasoning for
    // why guessing one is worse than refusing.
    throw AppError.badRequest('This order has no branch recorded and cannot be voided');
  }

  const branchId = order.branchId;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELED } });

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: OrderStatus.CANCELED,
        note: 'Voided at the till',
        changedById: actorId,
      },
    });

    // Stock back, one movement per line, same discipline as a return's own
    // restock — CORRECTION rather than RETURNED: nothing came back from a
    // customer, the sale itself was undone.
    for (const item of order.items) {
      if (!item.productId) continue;

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId,
          delta: item.quantity,
          reason: StockMovementReason.CORRECTION,
          note: `Voided sale ${order.orderNumber}`,
          actorId,
        },
      });

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });

      await tx.branchStock.upsert({
        where: { productId_branchId: { productId: item.productId, branchId } },
        create: { productId: item.productId, branchId, quantity: item.quantity },
        update: { quantity: { increment: item.quantity } },
      });
    }

    // Every payment reversed with its own NEGATIVE row — `Payment.amount` is
    // signed exactly for this, the same reasoning a refund uses. Never edit
    // or delete the original: the till was counted against it once already,
    // and erasing it would make that count impossible to reconstruct.
    for (const payment of order.payments) {
      await tx.payment.create({
        data: {
          orderId,
          amount: payment.amount.negated(),
          method: 'void',
          actorId,
          note: `Reversal of payment ${payment.id}`,
        },
      });
    }
  });

  audit(req, {
    action: 'order.voided',
    entity: 'orders',
    entityId: orderId,
    changes: { status: { from: order.status, to: OrderStatus.CANCELED } },
  });

  return { orderId, orderNumber: order.orderNumber };
}

/* ─────────────────────────────────────────────────────────────────────
 * PARK / RESUME A SALE (O9.12b)
 * ───────────────────────────────────────────────────────────────────── */

export interface ParkedSaleLine {
  productId: string;
  quantity: number;
  discountPercent?: number | undefined;
}

/** What a parked-cart row looks like on the wire — `lines` cast out of the
 *  DB's opaque `Json` column into the shape this module writes it as. */
export interface ParkedSaleSummary {
  id: string;
  label: string | null;
  lines: ParkedSaleLine[];
  createdAt: Date;
}

function toParkedSaleSummary(row: {
  id: string;
  label: string | null;
  lines: Prisma.JsonValue;
  createdAt: Date;
}): ParkedSaleSummary {
  return {
    id: row.id,
    label: row.label,
    lines: row.lines as unknown as ParkedSaleLine[],
    createdAt: row.createdAt,
  };
}

/**
 * Set a cart aside mid-sale.
 *
 * Stores CART SHAPE only — product id, quantity, the cashier's own line
 * discount — never a price or stock snapshot. A park is meant to last
 * minutes, not lock in a figure; resuming re-fetches both through the
 * ordinary browse path, the same as if the cashier had just built the cart
 * fresh. No stock is reserved: the shelf does not know a cart exists.
 */
export async function parkSale(
  cashierId: string,
  branchId: string,
  lines: ParkedSaleLine[],
  label: string | undefined,
): Promise<ParkedSaleSummary> {
  if (lines.length === 0) {
    throw AppError.badRequest('Cannot park an empty cart', { field: 'lines' });
  }

  const row = await prisma.parkedSale.create({
    data: {
      cashierId,
      branchId,
      lines: lines as unknown as Prisma.InputJsonValue,
      label: label ?? null,
    },
    select: { id: true, label: true, lines: true, createdAt: true },
  });

  return toParkedSaleSummary(row);
}

/** Every cart this cashier has parked at this branch, oldest first — the
 *  counter fills up through a shift, and the first one set aside is usually
 *  the first one somebody comes back for. */
export async function listParkedSales(
  cashierId: string,
  branchId: string,
): Promise<ParkedSaleSummary[]> {
  const rows = await prisma.parkedSale.findMany({
    where: { cashierId, branchId },
    select: { id: true, label: true, lines: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toParkedSaleSummary);
}

/**
 * Bring a parked cart back to the register and forget it was ever parked.
 *
 * Deleted rather than left behind on resume: a parked row's only job is to
 * survive the gap between setting a cart down and picking it back up, and a
 * resumed one sitting in the list would look like a second, stale copy of
 * the same customer's order.
 */
export async function resumeParkedSale(
  id: string,
  cashierId: string,
): Promise<ParkedSaleSummary> {
  const row = await prisma.parkedSale.findUnique({
    where: { id },
    select: { id: true, cashierId: true, label: true, lines: true, createdAt: true },
  });

  if (!row) throw AppError.notFound('Parked sale not found');

  // Only the cashier who set it down — nobody else's till should be able to
  // pull somebody else's cart onto their own screen.
  if (row.cashierId !== cashierId) {
    throw AppError.forbidden('You can only resume a cart you parked yourself');
  }

  await prisma.parkedSale.delete({ where: { id } });

  return toParkedSaleSummary(row);
}

/** Give up on a parked cart without resuming it — the customer never came
 *  back. Same ownership rule as resuming. */
export async function discardParkedSale(id: string, cashierId: string): Promise<void> {
  const row = await prisma.parkedSale.findUnique({
    where: { id },
    select: { cashierId: true },
  });

  if (!row) throw AppError.notFound('Parked sale not found');

  if (row.cashierId !== cashierId) {
    throw AppError.forbidden('You can only discard a cart you parked yourself');
  }

  await prisma.parkedSale.delete({ where: { id } });
}
