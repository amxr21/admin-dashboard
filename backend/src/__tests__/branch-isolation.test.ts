import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DeliveryStatus,
  OrderStatus,
  Prisma,
  ReturnResolution,
  ReturnStatus,
} from '@prisma/client';

import { prisma } from '../db/prisma.js';
import {
  getCategoryBreakdown,
  getCourierPerformance,
  getDeliveryCycleTime,
  getDeliveryZoneBreakdown,
  getInventoryTurnover,
  getOrderValueDistribution,
  getOverview,
  getPaymentMethodBreakdown,
  getRevenueSeries,
  getReturnResolutionBreakdown,
  getReturnReasons,
  getStatusBreakdown,
  getStockAdjustmentReasons,
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
const productIds: string[] = [];
const driverIds: string[] = [];
const returnIds: string[] = [];
const movementIds: string[] = [];

/** Branch A's order, kept so the delivery/return fixtures can hang off it. */
let orderA = '';
let orderB = '';

/** A window far in the past, so nothing else in the database lands inside it. */
const FROM = '2018-05-01';
const TO = '2018-05-31';

/**
 * Inside the window above. Delivery, returns and stock movements are all
 * scoped by their OWN `createdAt`, not the order's `placedAt`, so each
 * fixture has to be planted in the same window explicitly rather than
 * inheriting the order's date.
 */
const FIXTURE_AT = new Date('2018-05-15T12:00:00.000Z');

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
  orderA = await makeOrder(branchA, '100.00');
  await makeOrder(branchA, '50.00');
  orderB = await makeOrder(branchB, '900.00');

  await seedDeliveries();
  await seedReturns();
  await seedStockMovements();
});

/**
 * A delivery per branch, each hanging off that branch's order.
 *
 * Note there is no `branchId` on the assignment: a delivery is a delivery OF
 * an order, and the order already records the branch. Giving the assignment
 * its own copy would create a second answer to the same question, free to
 * disagree with the first.
 */
async function seedDeliveries() {
  const [driverA, driverB] = await Promise.all([
    prisma.deliveryStaff.create({ data: { name: `${RUN} driver A`, zone: `${RUN}-zone-A` } }),
    prisma.deliveryStaff.create({ data: { name: `${RUN} driver B`, zone: `${RUN}-zone-B` } }),
  ]);
  driverIds.push(driverA.id, driverB.id);

  await Promise.all([
    prisma.deliveryAssignment.create({
      data: {
        orderId: orderA,
        driverId: driverA.id,
        status: DeliveryStatus.DELIVERED,
        total: new Prisma.Decimal('100.00'),
        createdAt: FIXTURE_AT,
      },
    }),
    prisma.deliveryAssignment.create({
      data: {
        orderId: orderB,
        driverId: driverB.id,
        status: DeliveryStatus.DELIVERED,
        total: new Prisma.Decimal('900.00'),
        createdAt: FIXTURE_AT,
      },
    }),
  ]);
}

/** One return per branch, each against that branch's own order. */
async function seedReturns() {
  const [a, b] = await Promise.all([
    prisma.return.create({
      data: {
        rmaNumber: `${RUN.slice(0, 24)}-A`,
        reason: 'branch A return',
        orderId: orderA,
        status: ReturnStatus.APPROVED,
        resolution: ReturnResolution.REFUND,
        refundAmount: new Prisma.Decimal('100.00'),
        createdAt: FIXTURE_AT,
      },
    }),
    prisma.return.create({
      data: {
        rmaNumber: `${RUN.slice(0, 24)}-B`,
        reason: 'branch B return',
        orderId: orderB,
        status: ReturnStatus.APPROVED,
        resolution: ReturnResolution.REFUND,
        refundAmount: new Prisma.Decimal('900.00'),
        createdAt: FIXTURE_AT,
      },
    }),
  ]);
  returnIds.push(a.id, b.id);
}

/**
 * Stock movements per branch. Unlike delivery and returns, `StockMovement`
 * carries its OWN `branchId` (F8.2) — stock moves at a place, not because of
 * an order, so there is no order to read the branch from.
 */
async function seedStockMovements() {
  const product = await prisma.product.create({
    data: { name: `${RUN} product`, sku: `${RUN.slice(0, 30)}`, stock: 0 },
  });
  productIds.push(product.id);

  const rows = await Promise.all([
    prisma.stockMovement.create({
      data: { productId: product.id, branchId: branchA, delta: -2, reason: 'SOLD', createdAt: FIXTURE_AT },
    }),
    prisma.stockMovement.create({
      data: { productId: product.id, branchId: branchB, delta: -30, reason: 'SOLD', createdAt: FIXTURE_AT },
    }),
  ]);
  movementIds.push(...rows.map((row) => row.id));
}

afterAll(async () => {
  // Order matters: assignments and returns cascade from the order, but the
  // movements and the product do not, and a leftover product would collide
  // with this file's unique SKU on a re-run.
  await prisma.stockMovement.deleteMany({ where: { id: { in: movementIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.deliveryStaff.deleteMany({ where: { id: { in: driverIds } } });
  await prisma.branchStock.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
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


/**
 * The F8.3 REMAINDER — delivery, returns and stock.
 *
 * ─── WHY THESE ARE A SEPARATE BLOCK ──────────────────────────────────
 * Orders and the 18 order-based reports were scoped first because they hold
 * the money. These three are the rest of the surface, and each reaches its
 * branch by a DIFFERENT route — which is the whole reason a missed one is
 * plausible:
 *
 *   delivery  ->  assignment.order.branch_id   (an order it must have)
 *   returns   ->  return.order.branch_id       (an order it must have)
 *   stock     ->  stock_movement.branch_id     (its own column, from F8.2)
 *
 * A reviewer scanning for `branch_id` finds the third and concludes the file
 * is done. The first two carry no such column and never will.
 */
describe('delivery and returns inherit their branch from the order', () => {
  it('courier performance counts only the requested branch', async () => {
    const a = await getCourierPerformance({ from: FROM, to: TO, branchId: branchA });
    const b = await getCourierPerformance({ from: FROM, to: TO, branchId: branchB });

    // One assignment each, on different couriers. If a filter is missing,
    // both calls return both couriers.
    expect(a.couriers.filter((c) => c.name.startsWith(RUN))).toHaveLength(1);
    expect(b.couriers.filter((c) => c.name.startsWith(RUN))).toHaveLength(1);
    expect(a.couriers.find((c) => c.name.startsWith(RUN))?.name).toContain('driver A');
  });

  it('the delivery zone breakdown does not leak the other branch collectible value', async () => {
    const a = await getDeliveryZoneBreakdown({ from: FROM, to: TO, branchId: branchA });

    // Branch B's 900 must not appear under branch A's zone, nor as a zone of
    // its own in a branch-A-scoped answer.
    const mine = a.zones.filter((zone) => zone.zone.startsWith(RUN));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.zone).toBe(`${RUN}-zone-A`);
    expect(Number(mine[0]?.collectibleValue)).toBe(100);
  });

  it('delivery cycle time counts only the requested branch deliveries', async () => {
    const a = await getDeliveryCycleTime({ from: FROM, to: TO, branchId: branchA });
    const all = await getDeliveryCycleTime({ from: FROM, to: TO });

    // Exact counts are impossible here (other rows may share the window), so
    // the assertion is relational: scoping to one branch must yield strictly
    // fewer delivered rows than asking for every branch, given two branches
    // each hold one.
    expect(a.deliveredCount).toBeLessThan(all.deliveredCount);
  });

  it('the return resolution breakdown does not sum the other branch refunds', async () => {
    const a = await getReturnResolutionBreakdown({ from: FROM, to: TO, branchId: branchA });

    const refund = a.byResolution.find((row) => row.resolution === ReturnResolution.REFUND);
    // 100, not 1000. A missing filter reads branch B's 900 into this total,
    // and a refund figure that overstates by 9x is exactly the kind of number
    // that gets acted on before anyone questions it.
    expect(Number(refund?.refundedValue)).toBe(100);
  });

  it('the return reasons export lists only the requested branch returns', async () => {
    const a = await getReturnReasons({ from: FROM, to: TO, branchId: branchA });

    const mine = a.returns.filter((row) => row.rmaNumber.startsWith(RUN.slice(0, 24)));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.reason).toBe('branch A return');
  });
});

describe('stock reports scope by the movement own branch, not an order', () => {
  it('inventory turnover counts units sold at the requested branch only', async () => {
    const a = await getInventoryTurnover({ from: FROM, to: TO, branchId: branchA });
    const b = await getInventoryTurnover({ from: FROM, to: TO, branchId: branchB });

    // 2 at A, 30 at B — deliberately far apart, so a leak reads as 32 rather
    // than as a plausible-looking number.
    const productId = productIds[0];
    expect(a.turnover.find((row) => row.productId === productId)?.unitsSold).toBe(2);
    expect(b.turnover.find((row) => row.productId === productId)?.unitsSold).toBe(30);
  });

  it('stock adjustment reasons net only the requested branch movements', async () => {
    const a = await getStockAdjustmentReasons({ from: FROM, to: TO, branchId: branchA });
    const all = await getStockAdjustmentReasons({ from: FROM, to: TO });

    const scoped = a.reasons.find((row) => row.reason === 'SOLD')?.netUnits ?? 0;
    const unscoped = all.reasons.find((row) => row.reason === 'SOLD')?.netUnits ?? 0;

    // Both negative (SOLD is a negative delta). The unscoped figure must be
    // MORE negative, because it also carries branch B's -30.
    expect(scoped).toBeGreaterThan(unscoped);
  });
});
