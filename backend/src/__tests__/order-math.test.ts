import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import { computeOrderTotals } from '../services/order-math.service.js';

/**
 * The receipt arithmetic (O5.4).
 *
 * ─── WHY THIS IS WORTH ITS OWN SUITE ─────────────────────────────────
 * This maths lived only inside `demo-seed.ts`, and CLAUDE.md has flagged
 * since 2026-08-11 that a real checkout must call the SAME function. The
 * failure mode of two copies is not a crash: it is a receipt that disagrees
 * with the invoice for the same sale by a cent, found by a customer rather
 * than by a test.
 *
 * The cases below are the ones where a plausible-looking implementation gets
 * a different answer.
 */

const D = (value: string) => new Prisma.Decimal(value);
const NO_TAX = D('0');
const FIVE_PERCENT = D('0.05');

describe('order totals', () => {
  it('sums line price x quantity', () => {
    const totals = computeOrderTotals(
      [
        { price: D('4.50'), quantity: 2 },
        { price: D('1.25'), quantity: 4 },
      ],
      NO_TAX,
    );

    expect(totals.subtotal.toFixed(2)).toBe('14.00');
    expect(totals.taxAmount.toFixed(2)).toBe('0.00');
    expect(totals.total.toFixed(2)).toBe('14.00');
  });

  it('taxes the ORDER, not each line', () => {
    // Rounding each line's tax and summing gives a different answer from
    // taxing the sum — and the invoice shows ONE tax figure, so that figure
    // has to be the one actually charged.
    //
    // Per line: round(0.33*0.05)=0.02 each, x3 = 0.06.
    // Per order: round(0.99*0.05) = 0.05. They differ by a cent.
    const totals = computeOrderTotals([{ price: D('0.33'), quantity: 3 }], FIVE_PERCENT);

    expect(totals.subtotal.toFixed(2)).toBe('0.99');
    expect(totals.taxAmount.toFixed(2)).toBe('0.05');
    expect(totals.total.toFixed(2)).toBe('1.04');
  });

  it('rounds the subtotal so the receipt adds up', () => {
    // 3.333 x 3 = 9.999. Left unrounded, `Order.total` stores 10.499 — money
    // no till can take, on a receipt where subtotal + tax does not equal the
    // total. This is the bug the seeder's version had before O5.4.
    const totals = computeOrderTotals([{ price: D('3.333'), quantity: 3 }], FIVE_PERCENT);

    // `toString`, NOT `toFixed(2)`: toFixed would DISPLAY 9.999 as "10.00"
    // and hide the very thing this test exists to catch. What matters is the
    // value that reaches the database column.
    expect(totals.subtotal.toString()).toBe('10');
    expect(totals.total.toString()).toBe('10.5');
    expect(totals.taxAmount.toFixed(2)).toBe('0.50');
  });

  it('always has subtotal + tax equal to total', () => {
    // The invariant a printed document depends on. Checked across awkward
    // values rather than one convenient case.
    const cases: [string, number][] = [
      ['0.01', 1],
      ['9.99', 7],
      ['19.95', 3],
      ['0.10', 33],
      ['1234.56', 2],
    ];

    for (const [price, quantity] of cases) {
      const totals = computeOrderTotals([{ price: D(price), quantity }], FIVE_PERCENT);

      // Compared as stored values, not formatted ones — two amounts that
      // differ in the third decimal both format to the same 2dp string, so
      // toFixed here would assert nothing.
      expect(totals.subtotal.plus(totals.taxAmount).toString()).toBe(totals.total.toString());
      // And nothing is ever stored with sub-cent precision.
      expect(totals.subtotal.decimalPlaces()).toBeLessThanOrEqual(2);
      expect(totals.total.decimalPlaces()).toBeLessThanOrEqual(2);
    }
  });

  it('treats a zero rate as no tax, not as a missing rate', () => {
    // 0% is a real configured choice — "no tax here" — and must produce a
    // recorded 0.00 rather than being confused with "never set".
    const totals = computeOrderTotals([{ price: D('10.00'), quantity: 1 }], NO_TAX);

    expect(totals.taxAmount.toFixed(2)).toBe('0.00');
    expect(totals.total.toFixed(2)).toBe('10.00');
  });

  it('returns zeroes for an empty basket rather than throwing', () => {
    // A cart cleared mid-checkout is a real state; the till should show 0.00,
    // not an error.
    const totals = computeOrderTotals([], FIVE_PERCENT);

    expect(totals.subtotal.toFixed(2)).toBe('0.00');
    expect(totals.total.toFixed(2)).toBe('0.00');
  });

  it('does not drift over many lines', () => {
    // Floats lose 0.10 immediately: 0.1 x 3 !== 0.3 in IEEE 754. Decimal must
    // not, or a day's till is out by cents nobody can account for.
    const lines = Array.from({ length: 30 }, () => ({ price: D('0.10'), quantity: 1 }));

    const totals = computeOrderTotals(lines, NO_TAX);

    expect(totals.subtotal.toFixed(2)).toBe('3.00');
  });
});
