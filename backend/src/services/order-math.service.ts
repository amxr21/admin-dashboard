import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { SETTINGS } from '../config/settings.config.js';

/**
 * The receipt arithmetic — subtotal, tax, total (O5.4).
 *
 * ─── WHY THIS EXISTS AS A SERVICE ────────────────────────────────────
 * This maths lived only inside `demo-seed.ts`. CLAUDE.md has flagged since
 * 2026-08-11 that a real checkout must call the SAME math, because the moment
 * there are two copies they can round differently, read the tax rate at
 * different times, or disagree about whether tax applies per line or per
 * order — and the symptom is a receipt that does not match the invoice for
 * the same sale, found by a customer rather than by a test.
 *
 * ─── EVERY AMOUNT IS `Decimal`, NEVER A NUMBER ───────────────────────
 * A float cannot represent 0.10 exactly. On one sale that is invisible; over
 * a day's till it is a variance nobody can explain.
 *
 * ─── TAX IS ROUNDED ONCE, ON THE ORDER TOTAL ─────────────────────────
 * Not per line. Rounding each line's tax and summing gives a different answer
 * from taxing the sum — up to a cent per line — and the invoice shows one tax
 * figure, so that figure has to be the one that was actually charged.
 */

export interface PriceableLine {
  /** Unit price at the time of sale. Already a snapshot by the time it
   *  reaches here — see `OrderItem.price`. */
  price: Prisma.Decimal;
  quantity: number;
  /** Defaults true for callers written before per-product VAT existed. */
  isTaxable?: boolean;
}

export interface OrderTotals {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  /** Grand total, tax included. This is what `Order.total` has always meant,
   *  and every Reports/Dashboard revenue figure reads it as such. */
  total: Prisma.Decimal;
}

/**
 * The store's tax rate as a fraction (5% → 0.05).
 *
 * A missing `Setting` row means the registry default, never zero — the same
 * rule `getSettingValue` follows. Treating "never configured" as 0% would
 * silently under-charge tax on every sale in a fresh install.
 */
export async function getTaxRate(): Promise<Prisma.Decimal> {
  const row = await prisma.setting.findUnique({
    where: { key: 'store.taxRate' },
    select: { value: true },
  });

  const percent = Number(row === null ? SETTINGS['store.taxRate'].default : row.value);

  // A corrupt or non-numeric row falls back to no tax rather than producing
  // NaN, which would propagate into `total` and store a garbage order.
  if (!Number.isFinite(percent)) return new Prisma.Decimal(0);

  return new Prisma.Decimal(percent).dividedBy(100);
}

/**
 * Subtotal, tax and total for a set of lines.
 *
 * Pure: takes the rate rather than reading it, so a caller creating several
 * orders reads the setting once, and so this is testable without a database.
 */
export function computeOrderTotals(
  lines: readonly PriceableLine[],
  taxRate: Prisma.Decimal,
): OrderTotals {
  const subtotal = lines
    .reduce((sum, line) => sum.plus(line.price.times(line.quantity)), new Prisma.Decimal(0))
    // Rounded here so the subtotal shown on the receipt is the one the tax was
    // calculated from. Leaving it unrounded lets a fractional cent leak into
    // the total and makes subtotal + tax != total on the printed document.
    .toDecimalPlaces(2);

  const taxableSubtotal = lines
    .filter((line) => line.isTaxable !== false)
    .reduce((sum, line) => sum.plus(line.price.times(line.quantity)), new Prisma.Decimal(0))
    .toDecimalPlaces(2);

  const taxAmount = taxableSubtotal.times(taxRate).toDecimalPlaces(2);

  return { subtotal, taxAmount, total: subtotal.plus(taxAmount) };
}

/**
 * Tax after an order-level discount when a basket mixes taxable and exempt
 * goods. Allocate the discount proportionally across the basket so the exempt
 * share never creates or absorbs VAT while the one order-level discount
 * snapshot remains reconcilable.
 */
export function computeDiscountedTaxAmount(
  subtotal: Prisma.Decimal,
  taxableSubtotal: Prisma.Decimal,
  discountAmount: Prisma.Decimal,
  taxRate: Prisma.Decimal,
): Prisma.Decimal {
  if (subtotal.lte(0) || taxableSubtotal.lte(0) || taxRate.lte(0)) {
    return new Prisma.Decimal(0);
  }

  const boundedDiscount = Prisma.Decimal.min(
    Prisma.Decimal.max(discountAmount, new Prisma.Decimal(0)),
    subtotal,
  );
  const taxableDiscountShare = boundedDiscount.times(taxableSubtotal).dividedBy(subtotal);
  const taxableAfterDiscount = Prisma.Decimal.max(
    taxableSubtotal.minus(taxableDiscountShare),
    new Prisma.Decimal(0),
  );

  return taxableAfterDiscount.times(taxRate).toDecimalPlaces(2);
}

export interface RefundableLine {
  /** `OrderItem.price` — the list price, before any line discount. */
  price: Prisma.Decimal;
  quantity: number;
  discountPercent?: Prisma.Decimal | null;
  /** NULL on lines that predate per-product VAT; those were all taxed. */
  isTaxable?: boolean | null;
}

export interface RefundOrderSnapshot {
  subtotal: Prisma.Decimal | null;
  discountAmount: Prisma.Decimal | null;
  taxAmount: Prisma.Decimal | null;
  total: Prisma.Decimal;
  lines: readonly RefundableLine[];
}

function chargedValue(line: RefundableLine): Prisma.Decimal {
  const gross = line.price.times(line.quantity);
  return line.discountPercent == null
    ? gross
    : gross.times(new Prisma.Decimal(100).minus(line.discountPercent)).dividedBy(100);
}

/**
 * What the customer actually paid for some of an order's lines — the most a
 * return of those lines can refund, before any restocking fee.
 *
 * The line's charged value, less its proportional share of the order-level
 * discount, plus its proportional share of the snapshotted `taxAmount` among
 * the TAXABLE lines. Reading the snapshot rather than re-applying today's rate
 * means returning a whole order refunds exactly the tax that was charged, and
 * an exempt line never refunds VAT it never carried.
 *
 * Orders with no `subtotal` predate the tax columns: there is no recorded tax
 * split to refund against, so they fall back to the charged goods value.
 */
export interface RefundBreakdown {
  /** The most a return of these lines can pay back, before any fee. */
  refundable: Prisma.Decimal;
  /** The VAT inside `refundable`, unrounded. NULL when the order predates the
   *  tax columns and there is no recorded tax to apportion. */
  taxShare: Prisma.Decimal | null;
}

export function computeRefundBreakdown(
  order: RefundOrderSnapshot,
  returned: readonly RefundableLine[],
): RefundBreakdown {
  const zero = new Prisma.Decimal(0);
  const sum = (lines: readonly RefundableLine[]) =>
    lines.reduce((total, line) => total.plus(chargedValue(line)), zero);

  const goods = sum(returned);

  if (order.subtotal === null) return { refundable: goods.toDecimalPlaces(2), taxShare: null };

  const discountShare =
    order.discountAmount && order.subtotal.gt(0)
      ? order.discountAmount.times(goods).dividedBy(order.subtotal)
      : zero;

  const orderTaxable = sum(order.lines.filter((line) => line.isTaxable !== false));
  const taxShare =
    order.taxAmount && orderTaxable.gt(0)
      ? order.taxAmount
          .times(sum(returned.filter((line) => line.isTaxable !== false)))
          .dividedBy(orderTaxable)
      : zero;

  const refundable = Prisma.Decimal.max(goods.minus(discountShare).plus(taxShare), zero);
  return {
    refundable: Prisma.Decimal.min(refundable, order.total).toDecimalPlaces(2),
    taxShare,
  };
}

export function computeRefundableValue(
  order: RefundOrderSnapshot,
  returned: readonly RefundableLine[],
): Prisma.Decimal {
  return computeRefundBreakdown(order, returned).refundable;
}

/**
 * The VAT inside a refund actually paid: the returned lines' tax share, scaled
 * by how much of their refundable value was paid back — a restocking fee or a
 * partial refund pays back proportionally less VAT too. NULL when the order has
 * no tax snapshot to apportion.
 */
export function computeRefundTaxAmount(
  breakdown: RefundBreakdown,
  refundAmount: Prisma.Decimal,
): Prisma.Decimal | null {
  if (breakdown.taxShare === null) return null;
  if (breakdown.refundable.lte(0)) return new Prisma.Decimal(0);

  return Prisma.Decimal.min(
    breakdown.taxShare.times(refundAmount).dividedBy(breakdown.refundable),
    refundAmount,
  ).toDecimalPlaces(2);
}
/** The common case: read the rate and compute in one call. */
export async function priceOrder(lines: readonly PriceableLine[]): Promise<OrderTotals> {
  return computeOrderTotals(lines, await getTaxRate());
}
