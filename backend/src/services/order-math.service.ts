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

  const taxAmount = subtotal.times(taxRate).toDecimalPlaces(2);

  return { subtotal, taxAmount, total: subtotal.plus(taxAmount) };
}

/** The common case: read the rate and compute in one call. */
export async function priceOrder(lines: readonly PriceableLine[]): Promise<OrderTotals> {
  return computeOrderTotals(lines, await getTaxRate());
}
