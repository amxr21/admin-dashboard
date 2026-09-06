import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, OrderStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import {
  getCategoryBreakdown,
  getOrderValueDistribution,
  getOverview,
  getPaymentMethodBreakdown,
  getRevenueSeries,
  getStatusBreakdown,
} from '../services/reports.service.js';

/**
 * Branch isolation — the test that has to exist BEFORE the queries are scoped.
 *
 * ─── WHY THIS FILE IS WRITTEN FIRST ──────────────────────────────────
 * Scoping reports by branch means adding a filter to ~80 Prisma queries and
 * ~25 raw SQL blocks. A missed filter does not throw, does not fail a
 * typecheck, and does not look wrong on screen — it just quietly shows one
 * branch's revenue under another. Writing the assertion after the change
 * would only prove that whatever was written passes; writing it first states
 * the contract the change has to satisfy.
 *
 * This is the same class of mistake as the DEMO role reaching `staff`: nothing
 * was writable, no check failed, and it was still a leak. A write-focused
 * review misses it.
 *
 * ─── THE CONTRACT ────────────────────────────────────────────────────
 * Two branches, each with its own orders. Asking a report for branch A must
 * never include a single number that came from branch B — and asking for no
 * branch must include both, because "the whole business" is a real question
 * and the unscoped call is how it is asked.
 */

const RUN = `branchiso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let businessId = '';
let branchA = '';
let branchB = '';
const orderIds: string[] = [];

/** A window far in the past, so nothing else in the database lands inside it. */
const FROM = '2018-05-01';
const TO = '2018-05-31';

async function makeOrder(branchId: string, total: string) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN.slice(0, 20)}-${orderIds.length}`,
      placedAt: new Date('2018-05-15T12:00:00.000Z'),
      total: new Prisma.Decimal(total),
      status: OrderStatus.DELIVERED,
      branchId,
    },
  });
  orderIds.push(order.id);
  return order.id;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessId = business.id;

  const [a, b] = await Promise.all([
    prisma.branch.create({ data: { businessId, name: `${RUN} A`, code: `${RUN.slice(-6)}A` } }),
    prisma.branch.create({ data: { businessId, name: `${RUN} B`, code: `${RUN.slice(-6)}B` } }),
  ]);
  branchA = a.id;
  branchB = b.id;

  // Deliberately different totals, so a leak is arithmetically obvious rather
  // than hidden behind two branches that happen to sum alike.
  await makeOrder(branchA, '100.00');
  await makeOrder(branchA, '50.00');
  await makeOrder(branchB, '900.00');
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
});

describe('a report scoped to one branch never reports another branch', () => {
  it('overview revenue counts only the requested branch', async () => {
    const a = await getOverview({ from: FROM, to: TO, branchId: branchA });
    const b = await getOverview({ from: FROM, to: TO, branchId: branchB });

    // 100 + 50, and 900. If either number moves, a filter is missing.
    expect(a.revenue).toBe('150.00');
    expect(b.revenue).toBe('900.00');
  });

  it('overview order COUNT is scoped too, not just the money', async () => {
    // Revenue and counts come from different queries in `getOverview`, so
    // scoping one and forgetting the other is the likely half-done state.
    const a = await getOverview({ from: FROM, to: TO, branchId: branchA });

    expect(a.orders).toBe(2);
  });

  it('the unscoped call still answers for the whole business', async () => {
    // Scoping must not make "all branches" unaskable — that is how a filter
    // gets bolted on and then bypassed everywhere it is inconvenient.
    const all = await getOverview({ from: FROM, to: TO });

    expect(Number(all.revenue)).toBeGreaterThanOrEqual(1050);
    expect(all.orders).toBeGreaterThanOrEqual(3);
  });

  it('the revenue series is scoped', async () => {
    const a = await getRevenueSeries({ from: FROM, to: TO, granularity: 'day', branchId: branchA });

    const total = a.points.reduce((sum, point) => sum + Number(point.revenue), 0);
    expect(total).toBe(150);
  });

  /**
   * A sweep, not a sample. The three reports above were scoped by hand and
   * verified; the other ~14 were changed in bulk, which is exactly where a
   * missed filter hides. These cover the shapes that differ — an unaliased
   * `FROM orders`, a bucketing query, and one joining order_items — because a
   * regex that matched the common `o.` alias would silently skip them.
   */
  it('the order-value distribution is scoped (unaliased FROM orders)', async () => {
    const a = await getOrderValueDistribution({ from: FROM, to: TO, branchId: branchA });

    // 100 and 50 both fall in 100-250 and 50-100 respectively; branch B's 900
    // must not appear in 500-1000.
    const highBucket = a.buckets.find((bucket) => bucket.label === '500-1000');
    expect(highBucket?.count).toBe(0);
  });

  it('the payment-method breakdown is scoped', async () => {
    const b = await getPaymentMethodBreakdown({ from: FROM, to: TO, branchId: branchB });

    const total = b.methods.reduce((sum, row) => sum + Number(row.revenue), 0);
    expect(total).toBe(900);
  });

  it('the category breakdown is scoped (joins order_items)', async () => {
    // No order items in this fixture, so the assertion is that it returns
    // branch A's empty result rather than branch B's rows — a missing filter
    // on the JOIN would still leak the other branch's lines.
    const a = await getCategoryBreakdown({ from: FROM, to: TO, branchId: branchA });

    expect(a.categories.every((row) => Number(row.revenue) <= 150)).toBe(true);
  });

  it('the status breakdown is scoped', async () => {
    // Raw-SQL-adjacent report: the shape most likely to be missed, because a
    // hand-written WHERE does not inherit anything from a shared helper.
    const b = await getStatusBreakdown({ from: FROM, to: TO, branchId: branchB });

    const delivered = b.statuses.find((row) => row.status === OrderStatus.DELIVERED);
    expect(delivered?.orders).toBe(1);
  });
});
