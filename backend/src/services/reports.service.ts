import { OrderStatus, Prisma, ReturnStatus, ReviewStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { auditWhere } from './audit.service.js';
import { getSettingValue } from './settings.service.js';

/**
 * Reporting — aggregation, not CRUD.
 *
 * ─── WHY THIS IS NOT THE RESOURCE ENGINE ─────────────────────────────
 * The engine reads rows and writes rows. Nothing here does either: every
 * response is a GROUP BY over a date range. There is no field list that could
 * express "revenue per week", and there is nothing to write.
 *
 * ─── REVENUE COMES FROM THE ORDER SNAPSHOT ───────────────────────────
 * `order.total` is denormalised on purpose. Reporting reads THAT, never a sum
 * of current product prices — otherwise editing a price today would silently
 * rewrite last quarter's revenue, and two runs of the same report would
 * disagree with no record of why.
 *
 * ─── WHAT COUNTS AS REVENUE ──────────────────────────────────────────
 * Cancelled orders are excluded. Returned orders are NOT — the money moved and
 * then came back, which is a different fact from a sale that never happened,
 * and hiding it makes returns invisible in exactly the report where they
 * matter. `EXCLUDED_FROM_REVENUE` is the single place that decision lives.
 */

/** A cancelled order never took money. Everything else did, at least once. */
const EXCLUDED_FROM_REVENUE: OrderStatus[] = [OrderStatus.CANCELED];

/**
 * Longest reportable window.
 *
 * Not arbitrary: an unbounded range is an unbounded scan, and this endpoint is
 * reachable by any role with the `reports` area. Two years covers
 * year-on-year comparison, which is the widest thing anyone actually asks for.
 */
export const MAX_RANGE_DAYS = 731;

export type Granularity = 'day' | 'week' | 'month';

/**
 * MySQL format strings, chosen from a FIXED map.
 *
 * ─── THIS IS THE INJECTION BOUNDARY ──────────────────────────────────
 * The granularity reaches SQL as part of the query STRUCTURE, not as a bound
 * parameter — so it can never come from the request directly. The request
 * picks a key; this map supplies the fragment. Same discipline as the resource
 * engine's delegate map: the caller chooses between declared options and never
 * supplies one.
 */
const DATE_FORMAT: Readonly<Record<Granularity, string>> = {
  day: '%Y-%m-%d',
  // Monday-based ISO week, rendered as its Monday so points sort naturally.
  week: '%Y-%m-%d',
  month: '%Y-%m-01',
};

export function isGranularity(value: string): value is Granularity {
  return Object.prototype.hasOwnProperty.call(DATE_FORMAT, value);
}

export interface RangeParams {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  to: string;
}

/** Parsed, validated and turned into the half-open interval the queries use. */
function resolveRange(params: RangeParams): { start: Date; end: Date } {
  const start = new Date(`${params.from}T00:00:00.000Z`);
  // Exclusive upper bound covering the whole of the end day — comparing
  // against midnight would silently drop everything ordered that day.
  const end = new Date(`${params.to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw AppError.badRequest('Use YYYY-MM-DD dates', { field: 'from' });
  }

  if (end <= start) {
    throw AppError.badRequest('The end date must not be before the start date', {
      field: 'to',
    });
  }

  const days = (end.getTime() - start.getTime()) / 86_400_000;

  if (days > MAX_RANGE_DAYS) {
    throw AppError.badRequest(
      `Choose a range of ${String(MAX_RANGE_DAYS)} days or fewer`,
      { field: 'from', maxDays: MAX_RANGE_DAYS },
    );
  }

  return { start, end };
}

function money(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

/**
 * Headline numbers for the dashboard.
 *
 * One transaction so the tiles cannot describe different moments — a revenue
 * figure from before an order landed next to a count from after it is the kind
 * of inconsistency nobody notices and everybody argues about later.
 */
export async function getOverview(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const inRange = { placedAt: { gte: start, lt: end } };
  const revenueWhere = {
    ...inRange,
    status: { notIn: EXCLUDED_FROM_REVENUE },
  };

  // The LIVE setting, never a magic number — otherwise this tile disagrees with
  // the Inventory page's own low-stock filter the moment an admin changes the
  // threshold, and the tile deep-links to exactly that page. Resolved before the
  // transaction because it is its own read.
  const lowStockThreshold = await getSettingValue('inventory.lowStockThreshold');

  const [revenue, orderCount, canceledCount, customerCount, lowStock, unitsSold] =
    await prisma.$transaction([
      prisma.order.aggregate({ where: revenueWhere, _sum: { total: true } }),
      prisma.order.count({ where: inRange }),
      prisma.order.count({ where: { ...inRange, status: OrderStatus.CANCELED } }),
      prisma.customer.count({ where: { createdAt: { gte: start, lt: end } } }),
      prisma.product.count({ where: { stock: { lte: lowStockThreshold } } }),
      // Same exclusion as revenue (`revenueWhere`, via the order relation) —
      // a canceled order's items were never actually sold, so counting their
      // quantity here would disagree with the revenue figure on the same tile
      // strip about which orders "happened."
      prisma.orderItem.aggregate({
        where: { order: revenueWhere },
        _sum: { quantity: true },
      }),
    ]);

  const total = revenue._sum.total ?? new Prisma.Decimal(0);
  const paidOrders = orderCount - canceledCount;

  return {
    range: { from: params.from, to: params.to },
    revenue: money(total),
    orders: orderCount,
    canceledOrders: canceledCount,
    newCustomers: customerCount,
    lowStockProducts: lowStock,
    unitsSold: unitsSold._sum.quantity ?? 0,
    // Guarded: dividing by zero orders would produce NaN, which serialises to
    // null and renders as a blank tile rather than an honest zero.
    averageOrderValue: paidOrders > 0 ? total.dividedBy(paidOrders).toFixed(2) : '0.00',
  };
}

export interface RevenueSeriesParams extends RangeParams {
  granularity: Granularity;
}

/**
 * Revenue over time.
 *
 * Raw SQL because neither Prisma's `groupBy` nor its aggregate can truncate a
 * date. The VALUES are bound parameters; only the format string is
 * interpolated, and it comes from the map above rather than from the request.
 */
export async function getRevenueSeries(params: RevenueSeriesParams) {
  const { start, end } = resolveRange(params);
  const format = DATE_FORMAT[params.granularity];

  const excluded = EXCLUDED_FROM_REVENUE;

  const rows =
    params.granularity === 'week'
      ? await prisma.$queryRaw<{ bucket: string; revenue: Prisma.Decimal; orders: bigint }[]>`
          SELECT DATE_FORMAT(DATE_SUB(placed_at, INTERVAL WEEKDAY(placed_at) DAY), ${format}) AS bucket,
                 SUM(total) AS revenue,
                 COUNT(*)   AS orders
          FROM orders
          WHERE placed_at >= ${start} AND placed_at < ${end}
            AND status NOT IN (${Prisma.join(excluded)})
          GROUP BY bucket
          ORDER BY bucket ASC
        `
      : await prisma.$queryRaw<{ bucket: string; revenue: Prisma.Decimal; orders: bigint }[]>`
          SELECT DATE_FORMAT(placed_at, ${format}) AS bucket,
                 SUM(total) AS revenue,
                 COUNT(*)   AS orders
          FROM orders
          WHERE placed_at >= ${start} AND placed_at < ${end}
            AND status NOT IN (${Prisma.join(excluded)})
          GROUP BY bucket
          ORDER BY bucket ASC
        `;

  return {
    range: { from: params.from, to: params.to },
    granularity: params.granularity,
    points: rows.map((row) => ({
      date: row.bucket,
      revenue: money(row.revenue),
      // COUNT returns BIGINT, which JSON.stringify throws on. Narrowed here
      // rather than at the route, so no caller can forget.
      orders: Number(row.orders),
    })),
  };
}

/**
 * Best sellers by revenue.
 *
 * Uses the LINE ITEM price, which is the price at time of order — the same
 * reason `order.total` is denormalised. A product whose price doubled last
 * month did not retroactively earn more in January.
 */
export async function getTopProducts(params: RangeParams & { limit?: number }) {
  const { start, end } = resolveRange(params);
  const limit = Math.min(50, Math.max(1, params.limit ?? 10));

  const rows = await prisma.$queryRaw<
    { productId: string | null; name: string | null; quantity: bigint; revenue: Prisma.Decimal }[]
  >`
    SELECT oi.product_id           AS productId,
           p.name                  AS name,
           SUM(oi.quantity)        AS quantity,
           SUM(oi.price * oi.quantity) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY oi.product_id, p.name
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  return {
    range: { from: params.from, to: params.to },
    products: rows.map((row) => ({
      productId: row.productId,
      // Null when the product was hard-deleted. Line items carry a price
      // snapshot but NOT a name, so there is nothing to fall back to and the
      // UI has to say so rather than render a blank row.
      name: row.name,
      quantity: Number(row.quantity),
      revenue: money(row.revenue),
    })),
  };
}

/**
 * How long an unfinished order has been stuck. Not arbitrary: PENDING is
 * "nobody has confirmed this yet" and CONFIRMED is "confirmed but not yet
 * shipped" — both are queues someone should be clearing, not states an order
 * is expected to sit in indefinitely. Exported so the frontend imports the
 * same numbers rather than restating them (same rule as
 * `DEFAULT_LOW_STOCK_THRESHOLD` in inventory.service.ts).
 */
export const PENDING_SLA_HOURS = 24;
export const CONFIRMED_SLA_HOURS = 48;

const ATTENTION_STATUSES = [OrderStatus.PENDING, OrderStatus.CONFIRMED] as const;
const SLA_HOURS_BY_STATUS: Record<(typeof ATTENTION_STATUSES)[number], number> = {
  PENDING: PENDING_SLA_HOURS,
  CONFIRMED: CONFIRMED_SLA_HOURS,
};

/**
 * Fulfillment health: how long orders actually spend in PENDING/CONFIRMED
 * (average, from real transitions), and which specific orders are stuck past
 * their SLA right now — a clickable queue, not just a count.
 *
 * ─── AVERAGE COMES FROM COMPLETED TRANSITIONS ONLY ────────────────────
 * `LEAD()` finds each order's NEXT status-history row; an order still sitting
 * in PENDING has no next row yet and is correctly excluded from the average
 * (it belongs in `needsAttention` instead, not in a number that would silently
 * drag the average down while looking like everything is fine).
 *
 * ─── BOTH HALVES SHARE THE SAME WINDOW ────────────────────────────────
 * `needsAttention` used to ignore `start`/`end` entirely (scan every
 * currently-stuck order, any age) while `avgHoursInStatus` respected the
 * selected range — two halves of one widget silently describing different
 * windows. Both now filter by `placedAt`, matching the rest of the dashboard.
 */
export async function getFulfillmentHealth(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const avgRows = await prisma.$queryRaw<{ toStatus: string; avgHours: number | null }[]>`
    SELECT to_status AS toStatus, AVG(TIMESTAMPDIFF(HOUR, entered_at, next_at)) AS avgHours
    FROM (
      SELECT h.to_status,
             h.created_at AS entered_at,
             LEAD(h.created_at) OVER (PARTITION BY h.order_id ORDER BY h.created_at) AS next_at
      FROM order_status_history h
      JOIN orders o ON o.id = h.order_id
      WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
    ) transitions
    WHERE next_at IS NOT NULL AND to_status IN ('PENDING', 'CONFIRMED')
    GROUP BY to_status
  `;

  const stuckPending = await prisma.$queryRaw<
    { id: string; orderNumber: string; enteredAt: Date }[]
  >`
    SELECT id, order_number AS orderNumber, placed_at AS enteredAt
    FROM orders
    WHERE status = 'PENDING'
      AND placed_at < ${new Date(Date.now() - PENDING_SLA_HOURS * 3_600_000)}
      AND placed_at >= ${start} AND placed_at < ${end}
    ORDER BY placed_at ASC
    LIMIT 50
  `;

  const stuckConfirmed = await prisma.$queryRaw<
    { id: string; orderNumber: string; enteredAt: Date }[]
  >`
    SELECT o.id, o.order_number AS orderNumber, h.enteredAt
    FROM orders o
    JOIN (
      SELECT order_id, MAX(created_at) AS enteredAt
      FROM order_status_history
      WHERE to_status = 'CONFIRMED'
      GROUP BY order_id
    ) h ON h.order_id = o.id
    WHERE o.status = 'CONFIRMED'
      AND h.enteredAt < ${new Date(Date.now() - CONFIRMED_SLA_HOURS * 3_600_000)}
      AND o.placed_at >= ${start} AND o.placed_at < ${end}
    ORDER BY h.enteredAt ASC
    LIMIT 50
  `;

  const now = Date.now();

  return {
    range: { from: params.from, to: params.to },
    avgHoursInStatus: ATTENTION_STATUSES.map((status) => {
      const raw = avgRows.find((row) => row.toStatus === status)?.avgHours;
      return {
        status,
        slaHours: SLA_HOURS_BY_STATUS[status],
        // MySQL's AVG() over an integer TIMESTAMPDIFF can cross the driver as
        // a string — coerced here so the JSON response is a real number, not
        // sometimes-a-string depending on the driver's mood.
        avgHours: raw == null ? null : Number(raw),
      };
    }),
    needsAttention: [
      ...stuckPending.map((row) => ({ ...row, status: OrderStatus.PENDING })),
      ...stuckConfirmed.map((row) => ({ ...row, status: OrderStatus.CONFIRMED })),
    ]
      .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())
      .map((row) => ({
        orderId: row.id,
        orderNumber: row.orderNumber,
        status: row.status,
        hoursInStatus: Math.floor((now - row.enteredAt.getTime()) / 3_600_000),
      })),
  };
}

/**
 * Returns/refunds — deliberately not folded into the revenue report, because
 * "how much came back and why" is a different question from "how much came
 * in", and burying it inside another report is how it stays under-built.
 *
 * ─── `returnRate` NEEDS A COHERENT DENOMINATOR ────────────────────────
 * `returnCount` is scoped by the RETURN's own approval date, matching the
 * order-outcomes report's RETURNED count — of the orders PLACED in this
 * window, how many are known-returned. Dividing that by `orderCount` (orders
 * placed in the same window) makes `returnRate` a coherent cohort rate that
 * agrees with the "Order outcomes" widget's RETURNED count for the same
 * range, rather than mixing a return's approval date against an unrelated
 * order-placement count. `refundValue`/`unitsReturned`/`topReturnedProducts`
 * stay scoped by the return's OWN `createdAt` — a deliberately different,
 * still-valid question ("how much refund flowed out during this window"),
 * matching revenue's own "recognise when the event happened" rule.
 */
export async function getReturnsSummary(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const inRange = { createdAt: { gte: start, lt: end } };
  const orderInRange = { placedAt: { gte: start, lt: end } };

  const [returnCount, orderCount, refundAgg, unitsAgg, byProduct] = await prisma.$transaction([
    prisma.return.count({ where: { order: orderInRange } }),
    prisma.order.count({ where: orderInRange }),
    prisma.return.aggregate({ where: inRange, _sum: { refundAmount: true } }),
    prisma.returnItem.aggregate({ where: { return: inRange }, _sum: { quantity: true } }),
    prisma.$queryRaw<
      { productId: string | null; name: string | null; units: bigint; returns: bigint }[]
    >`
      SELECT p.id AS productId, p.name AS name, SUM(ri.quantity) AS units, COUNT(DISTINCT r.id) AS returns
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      JOIN order_items oi ON oi.id = ri.order_item_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE r.created_at >= ${start} AND r.created_at < ${end}
      GROUP BY p.id, p.name
      ORDER BY units DESC
      LIMIT 10
    `,
  ]);

  return {
    range: { from: params.from, to: params.to },
    returnCount,
    orderCount,
    // Guarded the same way averageOrderValue is — zero orders must render as
    // an honest zero, never NaN-turned-null.
    returnRate: orderCount > 0 ? returnCount / orderCount : 0,
    refundValue: money(refundAgg._sum.refundAmount),
    unitsReturned: Number(unitsAgg._sum.quantity ?? 0),
    topReturnedProducts: byProduct.map((row) => ({
      productId: row.productId,
      name: row.name,
      unitsReturned: Number(row.units),
      returnCount: Number(row.returns),
    })),
  };
}

/** Fixed, ascending buckets — the CASE expression IS the injection boundary:
 *  no request value ever reaches the SQL string, only bound date parameters. */
const VALUE_BUCKETS = [
  { label: '0-50', max: 50 },
  { label: '50-100', max: 100 },
  { label: '100-250', max: 250 },
  { label: '250-500', max: 500 },
  { label: '500-1000', max: 1000 },
  { label: '1000+', max: null },
] as const;

/** Order-value distribution — a histogram, not just the average AOV. */
export async function getOrderValueDistribution(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
    SELECT
      CASE
        WHEN total < 50 THEN '0-50'
        WHEN total < 100 THEN '50-100'
        WHEN total < 250 THEN '100-250'
        WHEN total < 500 THEN '250-500'
        WHEN total < 1000 THEN '500-1000'
        ELSE '1000+'
      END AS bucket,
      COUNT(*) AS count
    FROM orders
    WHERE placed_at >= ${start} AND placed_at < ${end}
      AND status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY bucket
  `;

  return {
    range: { from: params.from, to: params.to },
    buckets: VALUE_BUCKETS.map((bucket) => ({
      label: bucket.label,
      count: Number(rows.find((row) => row.bucket === bucket.label)?.count ?? 0),
    })),
  };
}

/** Order counts per status, for a breakdown that sums to the total. */
export async function getStatusBreakdown(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.order.groupBy({
    by: ['status'],
    where: { placedAt: { gte: start, lt: end } },
    _count: { _all: true },
    _sum: { total: true },
  });

  // Every status appears, including zeroes — a missing bar reads as missing
  // data, where an explicit zero reads as "none of these happened".
  return {
    range: { from: params.from, to: params.to },
    statuses: Object.values(OrderStatus).map((status) => {
      const row = rows.find((candidate) => candidate.status === status);

      return {
        status,
        orders: row?._count._all ?? 0,
        total: money(row?._sum.total),
      };
    }),
  };
}

/** An order in any of these is still "in flight" — DELIVERED/CANCELED/
 *  RETURNED are terminal, so neither a courier assignment nor stock backing
 *  it is still actionable. */
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
];

const NEEDS_ATTENTION_LIMIT = 20;

/**
 * The dashboard's cross-cutting "needs attention" queue (C1.5) — four
 * different questions, one widget, because they share the same answer:
 * "something is stuck and only a human can unstick it."
 *
 * ─── DELIBERATELY LIVE STATE, NOT DATE-RANGE SCOPED ───────────────────
 * Unlike `getFulfillmentHealth` (whose queue is scoped to orders PLACED in
 * the selected window, so both halves of that widget agree on what window
 * they describe), a return sitting unapproved or a courier-less order
 * doesn't stop mattering because it was placed outside today's date filter
 * — it is either still blocking someone right now, or it isn't. Filtering
 * this by `placedAt` would let a real backlog scroll out of view just
 * because the user picked "last 7 days."
 *
 * ─── WHAT'S HERE VS WHAT'S STILL BLOCKED ──────────────────────────────
 * Four categories shipped: returns awaiting approval, reviews awaiting
 * moderation, orders with no courier assignment, and out-of-stock products
 * with still-open orders against them. Payments-pending-capture and
 * failed/past-ETA deliveries are NOT here — `paymentMethod` is a free-text
 * VarChar with no capture-state model (S7.3) and `DeliveryStatus` has no
 * FAILED value yet (S7.7, already flagged in CLAUDE.md as a known hole).
 * Building UI for either would mean inventing data this schema cannot
 * honestly report.
 */
export async function getNeedsAttention() {
  const [
    returnsAwaiting,
    reviewsAwaiting,
    unassignedOrders,
    outOfStockWithOpenOrders,
  ] = await prisma.$transaction([
    prisma.return.findMany({
      where: { status: ReturnStatus.REQUESTED },
      select: { id: true, rmaNumber: true, createdAt: true, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'asc' },
      take: NEEDS_ATTENTION_LIMIT,
    }),
    prisma.review.findMany({
      where: { status: ReviewStatus.PENDING },
      select: { id: true, rating: true, createdAt: true, product: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: NEEDS_ATTENTION_LIMIT,
    }),
    prisma.order.findMany({
      where: { status: { in: OPEN_ORDER_STATUSES }, assignment: null },
      select: { id: true, orderNumber: true, status: true, placedAt: true },
      orderBy: { placedAt: 'asc' },
      take: NEEDS_ATTENTION_LIMIT,
    }),
    prisma.product.findMany({
      where: {
        stock: { lte: 0 },
        orderItems: { some: { order: { status: { in: OPEN_ORDER_STATUSES } } } },
      },
      select: { id: true, name: true, sku: true, stock: true },
      orderBy: { name: 'asc' },
      take: NEEDS_ATTENTION_LIMIT,
    }),
  ]);

  // Counts are separate queries, not `.length` on the capped lists above —
  // otherwise a backlog of 40 returns would silently report "20" as if that
  // were the true total, understating exactly the thing this widget exists
  // to surface honestly.
  const [returnsCount, reviewsCount, unassignedCount, outOfStockCount] =
    await prisma.$transaction([
      prisma.return.count({ where: { status: ReturnStatus.REQUESTED } }),
      prisma.review.count({ where: { status: ReviewStatus.PENDING } }),
      prisma.order.count({ where: { status: { in: OPEN_ORDER_STATUSES }, assignment: null } }),
      prisma.product.count({
        where: {
          stock: { lte: 0 },
          orderItems: { some: { order: { status: { in: OPEN_ORDER_STATUSES } } } },
        },
      }),
    ]);

  return {
    returnsAwaitingApproval: {
      count: returnsCount,
      items: returnsAwaiting.map((row) => ({
        id: row.id,
        rmaNumber: row.rmaNumber,
        orderNumber: row.order.orderNumber,
        createdAt: row.createdAt.toISOString(),
      })),
    },
    reviewsAwaitingModeration: {
      count: reviewsCount,
      items: reviewsAwaiting.map((row) => ({
        id: row.id,
        rating: row.rating,
        // Null when the reviewed product was hard-deleted — same "nothing to
        // fall back to" situation as a return's/order's own deleted-product
        // line items elsewhere in this file.
        productName: row.product?.name ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    },
    unassignedDeliveries: {
      count: unassignedCount,
      items: unassignedOrders.map((row) => ({
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status,
        placedAt: row.placedAt.toISOString(),
      })),
    },
    outOfStockWithOpenOrders: {
      count: outOfStockCount,
      items: outOfStockWithOpenOrders.map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        stock: row.stock,
      })),
    },
  };
}

/**
 * Staff activity (C3.5) — who did what, how often, in the selected window.
 * Reuses `auditWhere` from `audit.service.ts` (read-only import — that file
 * is Track B's) rather than a second copy of the same filter, so this can
 * never disagree with what the audit viewer itself would show for the same
 * range. Grouped by actor, not by row, since "who has been busiest" is the
 * question this answers — the audit viewer already covers "show me every
 * row" in full detail.
 */
export async function getStaffActivity(params: RangeParams) {
  const { start, end } = resolveRange(params);
  const where = auditWhere({ from: params.from, to: params.to });

  const rows = await prisma.auditLog.groupBy({
    by: ['actorId', 'actorEmail', 'actorRole'],
    where,
    _count: { _all: true },
  });

  // A denied attempt is a real, countable event ("who tried to do something
  // they couldn't"), same discipline as the audit trail itself distinguishing
  // outcomes rather than only logging successes. Grouped by the SAME three
  // fields as the main query, not `actorId` alone — several rows share a
  // null `actorId` (an unauthenticated attempt, or several different staff
  // whose accounts have since been deleted) and keying on `actorId` alone
  // would collapse all of them onto one shared denied-count.
  const deniedRows = await prisma.auditLog.groupBy({
    by: ['actorId', 'actorEmail', 'actorRole'],
    where: { ...where, outcome: 'DENIED' },
    _count: { _all: true },
  });
  const actorKey = (row: { actorId: string | null; actorEmail: string | null; actorRole: string | null }) =>
    `${row.actorId ?? ''}|${row.actorEmail ?? ''}|${row.actorRole ?? ''}`;
  const deniedByActor = new Map(deniedRows.map((row) => [actorKey(row), row._count._all]));

  return {
    range: { from: params.from, to: params.to },
    staff: rows
      .map((row) => ({
        actorId: row.actorId,
        // Null actorId means the actor's account no longer exists — the
        // denormalised email (kept specifically so it survives deletion,
        // see AuditLog's own schema comment) still identifies the row.
        actorEmail: row.actorEmail ?? '(unknown)',
        actorRole: row.actorRole,
        actionCount: row._count._all,
        deniedCount: deniedByActor.get(actorKey(row)) ?? 0,
      }))
      .sort((a, b) => b.actionCount - a.actionCount),
    // Kept separate from `resolveRange`'s own validation — this function has
    // no window cap of its own since `auditWhere`/AuditLog's indexes are on
    // `createdAt` directly, same cost shape as the audit viewer itself.
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

/**
 * Per-category breakdown (C3.5) — revenue and units by product category, in
 * the selected window. NOT a hierarchy rollup: `Category` has no `parentId`
 * yet (Track D's S7.6, unbuilt), so this is one flat level, matching what
 * the schema can actually express today. A product with no category (or a
 * hard-deleted one) is grouped under an explicit "(uncategorised)" bucket
 * rather than silently dropped — the units/revenue are real either way.
 */
export async function getCategoryBreakdown(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { categoryId: string | null; categoryName: string | null; units: bigint; revenue: Prisma.Decimal }[]
  >`
    SELECT c.id AS categoryId, c.name AS categoryName,
      SUM(oi.quantity) AS units,
      SUM(oi.price * oi.quantity) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY c.id, c.name
    ORDER BY revenue DESC
  `;

  return {
    range: { from: params.from, to: params.to },
    categories: rows.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? '(uncategorised)',
      units: Number(row.units),
      revenue: money(row.revenue),
    })),
  };
}

export type ExplorerDimension = 'status' | 'category' | 'product' | 'paymentMethod' | Granularity;

/** Every dimension is a real GROUP BY key that already exists on the order
 *  line-item join — nothing here is invented to fill out the picker. */
const EXPLORER_DIMENSIONS: readonly ExplorerDimension[] = [
  'day',
  'week',
  'month',
  'status',
  'category',
  'product',
  'paymentMethod',
];

export function isExplorerDimension(value: string): value is ExplorerDimension {
  return (EXPLORER_DIMENSIONS as readonly string[]).includes(value);
}

/** SQL fragment for the GROUP BY key + its display label, one per dimension.
 *  Kept in this fixed map for the same injection-boundary reason as
 *  `DATE_FORMAT` above — the request picks a key, never a raw fragment. */
function explorerDimensionSql(dimension: ExplorerDimension): { key: Prisma.Sql; label: Prisma.Sql } {
  switch (dimension) {
    case 'day':
    case 'week':
    case 'month':
      return {
        key: Prisma.sql`DATE_FORMAT(o.placed_at, ${DATE_FORMAT[dimension]})`,
        label: Prisma.sql`DATE_FORMAT(o.placed_at, ${DATE_FORMAT[dimension]})`,
      };
    case 'status':
      return { key: Prisma.sql`o.status`, label: Prisma.sql`o.status` };
    case 'category':
      return { key: Prisma.sql`c.id`, label: Prisma.sql`c.name` };
    case 'product':
      return { key: Prisma.sql`p.id`, label: Prisma.sql`p.name` };
    case 'paymentMethod':
      return { key: Prisma.sql`o.payment_method`, label: Prisma.sql`o.payment_method` };
  }
}

export interface ExplorerRow {
  key: string | null;
  label: string;
  revenue: string;
  units: number;
  orders: number;
  averageOrderValue: string;
}

/**
 * The generic report viewer's data source (C3.3) — one endpoint, a
 * caller-chosen GROUP BY dimension over the same order-line-item join every
 * other line-item report here already uses (`getTopProducts`,
 * `getCategoryBreakdown`). Not a new fact about the business, just a
 * different lens on facts already reported elsewhere — which is exactly
 * what "generic viewer" should mean: nothing is fabricated to make the
 * picker feel fuller than the schema actually supports.
 *
 * `orders` counts DISTINCT orders (an order with 3 line items in the same
 * bucket must not count as 3 orders), so `averageOrderValue` divides
 * revenue by a real denominator rather than double-counting.
 */
export async function getExplorerRows(
  params: RangeParams & { dimension: ExplorerDimension },
): Promise<{ range: { from: string; to: string }; dimension: ExplorerDimension; rows: ExplorerRow[] }> {
  const { start, end } = resolveRange(params);
  const { key, label } = explorerDimensionSql(params.dimension);

  // The bucket key/label are computed ONCE in the inner query and grouped by
  // their alias in the outer one — repeating the same `DATE_FORMAT(...)`
  // expression in both SELECT and GROUP BY does NOT satisfy MySQL's
  // `ONLY_FULL_GROUP_BY` here, because each occurrence of the templated
  // format-string parameter binds as a distinct placeholder even when the
  // value is identical, so MySQL can't prove the two expressions match.
  // Same fix already used by `getRefundRateTrend`'s bucketed subqueries.
  const rows = await prisma.$queryRaw<
    { key: string | null; label: string | null; revenue: Prisma.Decimal; units: bigint; orders: bigint }[]
  >`
    SELECT bucketKey AS \`key\`, bucketLabel AS label,
           SUM(revenue) AS revenue, SUM(units) AS units, COUNT(DISTINCT orderId) AS orders
    FROM (
      SELECT ${key}   AS bucketKey,
             ${label} AS bucketLabel,
             o.id AS orderId,
             oi.price * oi.quantity AS revenue,
             oi.quantity AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
        AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    ) x
    GROUP BY bucketKey, bucketLabel
    ORDER BY revenue DESC
  `;

  return {
    range: { from: params.from, to: params.to },
    dimension: params.dimension,
    rows: rows.map((row) => {
      const orders = Number(row.orders);
      const revenue = money(row.revenue);
      return {
        key: row.key,
        // Falls back per-dimension rather than a single generic "(none)" —
        // a null category and a null payment method are different absences.
        label: row.label ?? (params.dimension === 'category' ? '(uncategorised)' : '(none)'),
        revenue,
        units: Number(row.units),
        orders,
        averageOrderValue: orders > 0 ? (Number(revenue) / orders).toFixed(2) : '0.00',
      };
    }),
  };
}

/**
 * Refund-rate trend (C3.5) — refunded value as a share of revenue, bucketed
 * by month. Distinct from `getReturnsSummary`'s single-window snapshot: this
 * is the shape needed to answer "is our refund rate getting better or
 * worse", which a single number for one range cannot.
 */
export async function getRefundRateTrend(params: RangeParams) {
  const { start, end } = resolveRange(params);

  // Two separately grouped queries, merged in JS, rather than one query
  // with a correlated subquery — MySQL's ONLY_FULL_GROUP_BY mode (on by
  // default) rejects a subquery referencing a non-aggregated, non-grouped
  // column (`o.id`) inside a GROUP BY. Bucketing revenue by the ORDER's own
  // month and refunds by the SAME order's month (via the join below, not
  // the return's own `createdAt`) keeps both halves describing one trend.
  const [revenueRows, refundRows] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; revenue: Prisma.Decimal }[]>`
      SELECT DATE_FORMAT(o.placed_at, '%Y-%m-01') AS bucket, SUM(o.total) AS revenue
      FROM orders o
      WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
        AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
      GROUP BY bucket
    `,
    prisma.$queryRaw<{ bucket: string; refunded: Prisma.Decimal }[]>`
      SELECT DATE_FORMAT(o.placed_at, '%Y-%m-01') AS bucket, SUM(r.refund_amount) AS refunded
      FROM returns r
      JOIN orders o ON o.id = r.order_id
      WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
        AND r.refund_amount IS NOT NULL
      GROUP BY bucket
    `,
  ]);

  const refundedByBucket = new Map(refundRows.map((row) => [row.bucket, Number(row.refunded)]));

  return {
    range: { from: params.from, to: params.to },
    points: revenueRows
      .map((row) => {
        const revenue = Number(row.revenue);
        const refunded = refundedByBucket.get(row.bucket) ?? 0;

        return {
          date: row.bucket,
          revenue: money(row.revenue),
          refunded: refunded.toFixed(2),
          // Guarded the same way returnRate/averageOrderValue are elsewhere
          // in this file — zero revenue must render as an honest zero, not NaN.
          refundRate: revenue > 0 ? refunded / revenue : 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Inventory turnover / dead stock (C3.5) — units sold per product in the
 * window against current stock, so "moving fast" and "not moving at all"
 * are both visible from the same list. Reads `StockMovement`, the only real
 * source of "how much of this actually sold" (`OrderItem.quantity` records
 * what was ordered, not what was fulfilled from stock — SOLD movements are
 * the ledger entry stock.service.ts writes when it actually happens).
 * Dead stock = zero SOLD movement in the window despite carrying stock.
 */
export async function getInventoryTurnover(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.stockMovement.groupBy({
    by: ['productId'],
    where: { reason: 'SOLD', createdAt: { gte: start, lt: end }, productId: { not: null } },
    // SOLD movements are negative deltas — summing gives a negative number,
    // negated below to report a positive "units sold" count.
    _sum: { delta: true },
  });

  const soldByProduct = new Map(rows.map((row) => [row.productId, -(row._sum.delta ?? 0)]));

  const products = await prisma.product.findMany({
    where: { status: { not: 'ARCHIVED' } },
    select: { id: true, name: true, sku: true, stock: true },
  });

  const turnover = products
    .map((product) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      stock: product.stock,
      unitsSold: soldByProduct.get(product.id) ?? 0,
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold);

  return {
    range: { from: params.from, to: params.to },
    turnover,
    // Carries stock but sold nothing in the window — the actionable list, not
    // buried at the bottom of a long sorted table.
    deadStock: turnover.filter((row) => row.unitsSold === 0 && row.stock > 0),
  };
}

// ─── C3.5 (second batch) — customer, product, inventory, returns, delivery,
// audit domain reports. Same RangeParams → query → typed result → CSV shape
// as everything above. Each function's doc comment states which real write
// path populates the fields it reads, since a report over an always-null or
// never-written field would be indistinguishable from a real one until
// someone tried to act on it — see this file's header comment and the
// rejected "discount effectiveness"/"tax split" reports for why that
// distinction is checked explicitly, every time, rather than assumed from
// the schema alone.

/**
 * Customer geography (C3.5) — revenue, orders and units grouped by the
 * customer's recorded city/country. Guest orders (no `customerId`, or a
 * customer whose record was later deleted — `SetNull` on delete) fall into
 * an explicit "(unknown)" bucket rather than being dropped, same discipline
 * as `getCategoryBreakdown`'s "(uncategorised)".
 */
export async function getCustomerGeography(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { city: string | null; country: string | null; revenue: Prisma.Decimal; orders: bigint }[]
  >`
    SELECT c.city AS city, c.country AS country,
           SUM(o.total) AS revenue,
           COUNT(*) AS orders
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY c.city, c.country
    ORDER BY revenue DESC
  `;

  return {
    range: { from: params.from, to: params.to },
    rows: rows.map((row) => ({
      city: row.city ?? '(unknown)',
      country: row.country ?? '(unknown)',
      revenue: money(row.revenue),
      orders: Number(row.orders),
    })),
  };
}

/**
 * New vs. returning customer revenue (C3.5) — every order in the window is
 * classified by whether it is that customer's FIRST order ever (across all
 * time, not just this window) or a later one. A guest order (no
 * `customerId`) can never be "returning" by definition, so it's bucketed
 * under "new" alongside first-time customers — both represent revenue with
 * no prior relationship to bank on.
 */
export async function getCustomerNewVsReturning(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { bucket: 'new' | 'returning'; revenue: Prisma.Decimal; orders: bigint }[]
  >`
    SELECT
      CASE
        WHEN o.customer_id IS NULL THEN 'new'
        WHEN o.placed_at <= (
          SELECT MIN(o2.placed_at) FROM orders o2 WHERE o2.customer_id = o.customer_id
        ) THEN 'new'
        ELSE 'returning'
      END AS bucket,
      SUM(o.total) AS revenue,
      COUNT(*) AS orders
    FROM orders o
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY bucket
  `;

  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  const build = (bucket: 'new' | 'returning') => {
    const row = byBucket.get(bucket);
    return { revenue: money(row?.revenue), orders: row ? Number(row.orders) : 0 };
  };

  return {
    range: { from: params.from, to: params.to },
    new: build('new'),
    returning: build('returning'),
  };
}

/**
 * Customer lifetime value (C3.5) — top customers by ALL-TIME revenue and
 * order count (not scoped to the selected range: LTV is a running total by
 * definition, scoping it to a window would just re-describe that window's
 * top spenders, which `getTopProducts`-shaped reports already do for
 * products). `isRangeScoped: false` in the registry for the same reason
 * `getNeedsAttention` is — nothing here would change meaning on a schedule.
 */
export async function getCustomerLifetimeValue(limit = 20) {
  const rows = await prisma.$queryRaw<
    { customerId: string; name: string; email: string; revenue: Prisma.Decimal; orders: bigint }[]
  >`
    SELECT c.id AS customerId, c.name AS name, c.email AS email,
           SUM(o.total) AS revenue,
           COUNT(*) AS orders
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY c.id, c.name, c.email
    ORDER BY revenue DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `;

  return {
    customers: rows.map((row) => {
      const orders = Number(row.orders);
      const revenue = money(row.revenue);
      return {
        customerId: row.customerId,
        name: row.name,
        email: row.email,
        revenue,
        orders,
        averageOrderValue: orders > 0 ? (Number(revenue) / orders).toFixed(2) : '0.00',
      };
    }),
  };
}

/**
 * Customer order frequency / repeat-purchase rate (C3.5) — how many orders
 * each customer has placed within the window, bucketed into 1/2/3/4+, plus
 * a headline repeat-rate (share of customers with 2+ orders). Guest orders
 * (`customerId IS NULL`) are excluded from the per-customer count entirely
 * — "how many times did THIS customer order" has no meaning for an order
 * with no customer link, and folding guests into the "1 order" bucket would
 * silently inflate it with orders that were never really one customer's
 * first purchase.
 */
export async function getCustomerOrderFrequency(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<{ orderCount: bigint }[]>`
    SELECT COUNT(*) AS orderCount
    FROM orders o
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
      AND o.customer_id IS NOT NULL
    GROUP BY o.customer_id
  `;

  const buckets = { 1: 0, 2: 0, 3: 0, '4+': 0 } as Record<'1' | '2' | '3' | '4+', number>;
  for (const row of rows) {
    const count = Number(row.orderCount);
    const key = count >= 4 ? '4+' : (String(count) as '1' | '2' | '3');
    buckets[key] = (buckets[key] ?? 0) + 1;
  }

  const totalCustomers = rows.length;
  const repeatCustomers = totalCustomers - buckets['1'];

  return {
    range: { from: params.from, to: params.to },
    buckets: [
      { label: '1', customers: buckets['1'] },
      { label: '2', customers: buckets['2'] },
      { label: '3', customers: buckets['3'] },
      { label: '4+', customers: buckets['4+'] },
    ],
    totalCustomers,
    repeatRate: totalCustomers > 0 ? repeatCustomers / totalCustomers : 0,
  };
}

/**
 * Guest vs. registered-customer orders (C3.5) — orders with no `customerId`
 * (a true walk-in checkout, OR a customer record later deleted — `SetNull`
 * on delete means both look identical at this point, and the schema gives
 * no way to tell them apart after the fact) against orders with a real
 * customer link.
 */
export async function getGuestVsRegistered(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { bucket: 'guest' | 'registered'; revenue: Prisma.Decimal; orders: bigint }[]
  >`
    SELECT (CASE WHEN o.customer_id IS NULL THEN 'guest' ELSE 'registered' END) AS bucket,
           SUM(o.total) AS revenue,
           COUNT(*) AS orders
    FROM orders o
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY bucket
  `;

  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  const build = (bucket: 'guest' | 'registered') => {
    const row = byBucket.get(bucket);
    return { revenue: money(row?.revenue), orders: row ? Number(row.orders) : 0 };
  };

  return {
    range: { from: params.from, to: params.to },
    guest: build('guest'),
    registered: build('registered'),
  };
}

/**
 * Payment method breakdown (C3.5) — revenue and orders by the order's
 * recorded `paymentMethod`. Free-text field (no enum), so an order placed
 * before the field existed or logged inconsistently falls into an explicit
 * "(not recorded)" bucket rather than being silently dropped.
 */
export async function getPaymentMethodBreakdown(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { paymentMethod: string | null; revenue: Prisma.Decimal; orders: bigint }[]
  >`
    SELECT o.payment_method AS paymentMethod,
           SUM(o.total) AS revenue,
           COUNT(*) AS orders
    FROM orders o
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
    GROUP BY o.payment_method
    ORDER BY revenue DESC
  `;

  return {
    range: { from: params.from, to: params.to },
    methods: rows.map((row) => ({
      paymentMethod: row.paymentMethod ?? '(not recorded)',
      revenue: money(row.revenue),
      orders: Number(row.orders),
    })),
  };
}

/**
 * Product margin / profitability (C3.5) — revenue, cost of goods sold and
 * gross margin per product over the window, for products with a recorded
 * `cost` ONLY. `Product.cost` is nullable by design (see its own schema
 * comment: NULL means "not tracked yet", never a fabricated 0) — a product
 * with no cost is EXCLUDED here, not shown with a false 100% margin, and
 * counted separately so the gap itself is visible rather than silently
 * shrinking the report.
 */
export async function getProductMargin(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    {
      productId: string;
      name: string;
      sku: string | null;
      revenue: Prisma.Decimal;
      cogs: Prisma.Decimal;
      units: bigint;
    }[]
  >`
    SELECT p.id AS productId, p.name AS name, p.sku AS sku,
           SUM(oi.price * oi.quantity) AS revenue,
           SUM(p.cost * oi.quantity) AS cogs,
           SUM(oi.quantity) AS units
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
      AND p.cost IS NOT NULL
    GROUP BY p.id, p.name, p.sku
    ORDER BY (SUM(oi.price * oi.quantity) - SUM(p.cost * oi.quantity)) ASC
  `;

  const untracked = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.placed_at >= ${start} AND o.placed_at < ${end}
      AND o.status NOT IN (${Prisma.join(EXCLUDED_FROM_REVENUE)})
      AND p.cost IS NULL
  `;

  return {
    range: { from: params.from, to: params.to },
    products: rows.map((row) => {
      const revenue = Number(row.revenue);
      const cogs = Number(row.cogs);
      const margin = revenue - cogs;
      return {
        productId: row.productId,
        name: row.name,
        sku: row.sku,
        revenue: revenue.toFixed(2),
        cogs: cogs.toFixed(2),
        margin: margin.toFixed(2),
        marginPercent: revenue > 0 ? margin / revenue : 0,
        units: Number(row.units),
      };
    }),
    // A count, not a list — the untracked products are just every OTHER
    // product sold in the window; the point is to make the gap visible
    // ("N products sold here have no cost recorded"), not to duplicate the
    // catalogue's own product list.
    productsWithoutCost: Number(untracked[0]?.count ?? 0),
  };
}

/**
 * Product review-rating summary (C3.5) — average rating, review count and
 * the 1-5 star distribution per product, restricted to APPROVED reviews
 * only (a PENDING or REJECTED review is not yet/never a verified opinion
 * about the product — see `admin.config.ts`'s moderation gate). Windowed by
 * the review's own `createdAt`, not the product's.
 */
export async function getProductReviewSummary(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { productId: string | null; name: string | null; rating: number; count: bigint }[]
  >`
    SELECT r.product_id AS productId, p.name AS name, r.rating AS rating, COUNT(*) AS count
    FROM reviews r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE r.status = 'APPROVED'
      AND r.created_at >= ${start} AND r.created_at < ${end}
    GROUP BY r.product_id, p.name, r.rating
  `;

  const byProduct = new Map<
    string,
    { productId: string; name: string; distribution: Record<1 | 2 | 3 | 4 | 5, number>; total: number; sum: number }
  >();

  for (const row of rows) {
    if (!row.productId) continue; // A hard-deleted product's review carries no product to summarise against.
    const key = row.productId;
    const entry = byProduct.get(key) ?? {
      productId: key,
      name: row.name ?? '(deleted product)',
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      total: 0,
      sum: 0,
    };
    const count = Number(row.count);
    entry.distribution[row.rating as 1 | 2 | 3 | 4 | 5] = count;
    entry.total += count;
    entry.sum += row.rating * count;
    byProduct.set(key, entry);
  }

  return {
    range: { from: params.from, to: params.to },
    products: [...byProduct.values()]
      .map((entry) => ({
        productId: entry.productId,
        name: entry.name,
        reviewCount: entry.total,
        averageRating: entry.total > 0 ? entry.sum / entry.total : 0,
        distribution: entry.distribution,
      }))
      .sort((a, b) => b.reviewCount - a.reviewCount),
  };
}

/**
 * Review moderation throughput (C3.5) — how many reviews were submitted,
 * approved, rejected, or are still pending, in the window (by `createdAt`),
 * plus average hours from submission to moderation for reviews that HAVE
 * been moderated. A PENDING review has no moderation timestamp yet, so it
 * is counted but excluded from the average — including it would need a
 * fabricated "still waiting" duration measured against nothing.
 */
export async function getReviewModerationThroughput(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const counts = await prisma.review.groupBy({
    by: ['status'],
    where: { createdAt: { gte: start, lt: end } },
    _count: { _all: true },
  });

  const avgHoursRow = await prisma.$queryRaw<{ avgHours: number | null }[]>`
    SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, updated_at)) AS avgHours
    FROM reviews
    WHERE created_at >= ${start} AND created_at < ${end}
      AND status IN ('APPROVED', 'REJECTED')
  `;

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return {
    range: { from: params.from, to: params.to },
    submitted: counts.reduce((sum, row) => sum + row._count._all, 0),
    approved: byStatus.get('APPROVED') ?? 0,
    rejected: byStatus.get('REJECTED') ?? 0,
    pending: byStatus.get('PENDING') ?? 0,
    averageHoursToModeration: avgHoursRow[0]?.avgHours ?? null,
  };
}

/**
 * Products with no reviews (C3.5) — active products that have zero reviews
 * at all (any status, all-time — not windowed: "has this product ever been
 * reviewed" doesn't reset every period). A catalogue-attention list, same
 * category as `getNeedsAttention`'s queues — `isRangeScoped: false`.
 */
export async function getProductsWithoutReviews() {
  const products = await prisma.product.findMany({
    where: { status: { not: 'ARCHIVED' }, reviews: { none: {} } },
    select: { id: true, name: true, sku: true },
    orderBy: { name: 'asc' },
  });

  return {
    products: products.map((p) => ({ productId: p.id, name: p.name, sku: p.sku })),
  };
}

/**
 * Low-stock / stockout snapshot (C3.5) — every active product at or below
 * the LIVE low-stock threshold setting (same source `getOverview`'s tile
 * reads — see that function's own comment for why this must never be a
 * hardcoded number), with days since its last RECEIVED movement. Live
 * catalogue state, not date-range scoped — `isRangeScoped: false`, same
 * category as `getNeedsAttention`.
 */
export async function getLowStockSnapshot() {
  const threshold = await getSettingValue('inventory.lowStockThreshold');

  const products = await prisma.product.findMany({
    where: { status: { not: 'ARCHIVED' }, stock: { lte: threshold } },
    select: { id: true, name: true, sku: true, stock: true },
    orderBy: { stock: 'asc' },
  });

  if (products.length === 0) return { threshold, products: [] };

  const lastReceived = await prisma.stockMovement.groupBy({
    by: ['productId'],
    where: { productId: { in: products.map((p) => p.id) }, reason: 'RECEIVED' },
    _max: { createdAt: true },
  });
  const lastReceivedByProduct = new Map(lastReceived.map((row) => [row.productId, row._max.createdAt]));

  return {
    threshold,
    products: products.map((product) => {
      const last = lastReceivedByProduct.get(product.id) ?? null;
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        // Null means "never recorded as received" — genuinely unknown, not
        // fabricated as 0 days or the product's own creation date.
        daysSinceLastRestock: last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null,
      };
    }),
  };
}

/**
 * Stock adjustment reasons breakdown (C3.5) — units and movement count by
 * `StockMovementReason` in the window. RECEIVED/DAMAGED/LOST/CORRECTION are
 * written by staff's manual adjustment flow (`inventory.service.ts`,
 * `variants.service.ts`); RETURNED is written by the return-approval
 * restock path (`returns.service.ts`); SOLD is only as reliable as staff
 * diligence in logging it — same caveat `getInventoryTurnover` already
 * carries, not a new one introduced here.
 */
export async function getStockAdjustmentReasons(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.stockMovement.groupBy({
    by: ['reason'],
    where: { createdAt: { gte: start, lt: end } },
    _sum: { delta: true },
    _count: { _all: true },
  });

  return {
    range: { from: params.from, to: params.to },
    reasons: rows
      .map((row) => ({
        reason: row.reason,
        movements: row._count._all,
        // Signed sum kept as-is (RECEIVED positive, DAMAGED/LOST negative)
        // rather than absolute-valued — "net units" is the honest number;
        // flattening the sign would make RECEIVED and DAMAGED look the same.
        netUnits: row._sum.delta ?? 0,
      }))
      .sort((a, b) => b.movements - a.movements),
  };
}

/**
 * Variant-level stock movement (C3.5) — the same movement-ledger shape as
 * `getInventoryTurnover`/`getStockAdjustmentReasons`, but scoped to
 * `ProductVariant` via `StockMovement.variantId` — a genuinely separate
 * ledger from the product-level one (`variants.service.ts` writes real
 * movement rows keyed by variant, exactly parallel to the product path).
 */
export async function getVariantStockMovement(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.stockMovement.groupBy({
    by: ['variantId', 'reason'],
    where: { createdAt: { gte: start, lt: end }, variantId: { not: null } },
    _sum: { delta: true },
  });

  const variantIds = [...new Set(rows.map((row) => row.variantId).filter((id): id is string => id !== null))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, name: true, sku: true, stock: true, product: { select: { name: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const byVariant = new Map<
    string,
    { variantId: string; name: string; productName: string; sku: string | null; stock: number; sold: number; received: number }
  >();

  for (const row of rows) {
    if (!row.variantId) continue;
    const variant = variantById.get(row.variantId);
    if (!variant) continue;
    const entry = byVariant.get(row.variantId) ?? {
      variantId: row.variantId,
      name: variant.name,
      productName: variant.product.name,
      sku: variant.sku,
      stock: variant.stock,
      sold: 0,
      received: 0,
    };
    const delta = row._sum.delta ?? 0;
    if (row.reason === 'SOLD') entry.sold += -delta;
    if (row.reason === 'RECEIVED') entry.received += delta;
    byVariant.set(row.variantId, entry);
  }

  return {
    range: { from: params.from, to: params.to },
    variants: [...byVariant.values()].sort((a, b) => b.sold - a.sold),
  };
}

/**
 * Return resolution breakdown (C3.5) — counts and refunded value by
 * `resolution` (REFUND/STORE_CREDIT/REPLACEMENT/NONE) and by `status`
 * (REQUESTED/APPROVED/REJECTED), in the window. `resolution` is only ever
 * set to something other than NONE as part of the real approve-return
 * procedure in `returns.service.ts` — not a stray editable field.
 */
export async function getReturnResolutionBreakdown(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const [byResolution, byStatus] = await Promise.all([
    prisma.return.groupBy({
      by: ['resolution'],
      where: { createdAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { refundAmount: true },
    }),
    prisma.return.groupBy({
      by: ['status'],
      where: { createdAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
  ]);

  return {
    range: { from: params.from, to: params.to },
    byResolution: byResolution.map((row) => ({
      resolution: row.resolution,
      count: row._count._all,
      refundedValue: money(row._sum.refundAmount),
    })),
    byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
  };
}

/**
 * Return reasons export (C3.5) — `Return.reason` is a required, always-
 * populated free-text field on every return request, but it has NO
 * taxonomy to group by. This deliberately does NOT attempt keyword-based
 * categorisation (that would fabricate a classification scheme the schema
 * doesn't have) — it's a flat, readable export of reason text alongside the
 * return's own identifiers, meant for a human to read, not to chart.
 */
export async function getReturnReasons(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const returns = await prisma.return.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: { rmaNumber: true, reason: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return {
    range: { from: params.from, to: params.to },
    returns: returns.map((r) => ({
      rmaNumber: r.rmaNumber,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Courier / delivery-staff performance (C3.5) — per-courier count of
 * assignments by CURRENT `DeliveryStatus`, in the window (by assignment
 * `createdAt`). Reports "how many jobs are currently in each state per
 * courier," not full per-status transition timing — there is no
 * `DeliveryStatusHistory` table (unlike `OrderStatusHistory`, which genuinely
 * exists for orders), so anything claiming to time individual legs of a
 * delivery would be inventing timestamps the schema doesn't record.
 */
export async function getCourierPerformance(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.deliveryAssignment.groupBy({
    by: ['driverId', 'status'],
    where: { createdAt: { gte: start, lt: end } },
    _count: { _all: true },
  });

  const driverIds = [...new Set(rows.map((row) => row.driverId))];
  const drivers = await prisma.deliveryStaff.findMany({
    where: { id: { in: driverIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(drivers.map((d) => [d.id, d.name]));

  const byDriver = new Map<string, { driverId: string; name: string; total: number; byStatus: Record<string, number> }>();
  for (const row of rows) {
    const entry = byDriver.get(row.driverId) ?? {
      driverId: row.driverId,
      name: nameById.get(row.driverId) ?? '(unknown courier)',
      total: 0,
      byStatus: {},
    };
    entry.byStatus[row.status] = row._count._all;
    entry.total += row._count._all;
    byDriver.set(row.driverId, entry);
  }

  return {
    range: { from: params.from, to: params.to },
    couriers: [...byDriver.values()].sort((a, b) => b.total - a.total),
  };
}

/**
 * Delivery zone / region breakdown (C3.5) — assignment counts and total
 * collectible value grouped by the COURIER's home `zone`/`region` (real,
 * staff-editable fields on `DeliveryStaff`), used as a proxy for delivery
 * area since `DeliveryAssignment.area` itself is never written by any real
 * code path (confirmed: only `address`/`city`/`note`/`total` are set at
 * assignment time) — stated here explicitly rather than silently reporting
 * a field that would always read empty.
 */
export async function getDeliveryZoneBreakdown(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<
    { zone: string | null; region: string | null; assignments: bigint; total: Prisma.Decimal }[]
  >`
    SELECT d.zone AS zone, d.region AS region,
           COUNT(*) AS assignments,
           SUM(COALESCE(a.total, 0)) AS total
    FROM delivery_assignments a
    JOIN delivery_staff d ON d.id = a.driver_id
    WHERE a.created_at >= ${start} AND a.created_at < ${end}
    GROUP BY d.zone, d.region
    ORDER BY assignments DESC
  `;

  return {
    range: { from: params.from, to: params.to },
    zones: rows.map((row) => ({
      zone: row.zone ?? '(not set)',
      region: row.region ?? '(not set)',
      assignments: Number(row.assignments),
      collectibleValue: money(row.total),
    })),
  };
}

/**
 * Delivery cycle time (C3.5) — average/median hours from assignment
 * creation to delivery, restricted to assignments whose CURRENT status is
 * DELIVERED. `updatedAt` is used as the delivery timestamp: since
 * `updateAssignment` REFUSES any further edit once `status === DELIVERED`
 * (see that function's own guard), a currently-DELIVERED assignment's
 * `updatedAt` can only ever have been set by the transition INTO DELIVERED
 * — a real proxy, not a guess. This is narrower than `OrderStatusHistory`
 * gives orders (no per-leg timing), and that limit is stated here rather
 * than implied away.
 */
export async function getDeliveryCycleTime(params: RangeParams) {
  const { start, end } = resolveRange(params);

  // TIMESTAMPDIFF returns a MySQL BIGINT, which surfaces as a JS `bigint`
  // here (not `number`) — must be converted before any arithmetic/sort.
  const rows = await prisma.$queryRaw<{ hours: bigint }[]>`
    SELECT TIMESTAMPDIFF(HOUR, created_at, updated_at) AS hours
    FROM delivery_assignments
    WHERE status = 'DELIVERED'
      AND created_at >= ${start} AND created_at < ${end}
  `;

  const hours = rows.map((r) => Number(r.hours)).sort((a, b) => a - b);
  const average = hours.length > 0 ? hours.reduce((sum, h) => sum + h, 0) / hours.length : null;
  const median = hours.length > 0 ? hours[Math.floor(hours.length / 2)]! : null;

  return {
    range: { from: params.from, to: params.to },
    deliveredCount: hours.length,
    averageHours: average,
    medianHours: median,
  };
}

/**
 * Courier workload / active-roster snapshot (C3.5) — live counts of
 * couriers by `DeliveryStaffStatus` and their current open (non-terminal)
 * assignment count. Live state, not date-range scoped — `isRangeScoped:
 * false`, same category as `getNeedsAttention`.
 */
export async function getCourierWorkloadSnapshot() {
  const [byStatus, openAssignments] = await Promise.all([
    prisma.deliveryStaff.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.deliveryAssignment.groupBy({
      by: ['driverId'],
      where: { status: { notIn: ['DELIVERED', 'HANDED_OVER', 'CANCELED', 'RETURNED'] } },
      _count: { _all: true },
    }),
  ]);

  const openByDriver = new Map(openAssignments.map((row) => [row.driverId, row._count._all]));
  const drivers = await prisma.deliveryStaff.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { name: 'asc' },
  });

  return {
    byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
    couriers: drivers.map((driver) => ({
      driverId: driver.id,
      name: driver.name,
      status: driver.status,
      openAssignments: openByDriver.get(driver.id) ?? 0,
    })),
  };
}

/**
 * Security/audit outcome trend (C3.5) — count of `AuditLog` rows by
 * `outcome` (SUCCESS/DENIED/ERROR), bucketed by day, in the window. SUCCESS
 * and DENIED are genuinely written on every audited action (`audit()`
 * defaults to SUCCESS, `denied()` sets DENIED); ERROR is a declared enum
 * value no code path in this app currently sets — it will honestly read as
 * zero rather than being omitted from the shape, so a future write path
 * doesn't need a schema change to show up here.
 */
export async function getAuditOutcomeTrend(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.$queryRaw<{ bucket: string; outcome: string; count: bigint }[]>`
    SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS bucket, outcome AS outcome, COUNT(*) AS count
    FROM audit_log
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY bucket, outcome
    ORDER BY bucket ASC
  `;

  const byBucket = new Map<string, { date: string; success: number; denied: number; error: number }>();
  for (const row of rows) {
    const entry = byBucket.get(row.bucket) ?? { date: row.bucket, success: 0, denied: 0, error: 0 };
    const count = Number(row.count);
    if (row.outcome === 'SUCCESS') entry.success = count;
    else if (row.outcome === 'DENIED') entry.denied = count;
    else if (row.outcome === 'ERROR') entry.error = count;
    byBucket.set(row.bucket, entry);
  }

  return {
    range: { from: params.from, to: params.to },
    points: [...byBucket.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Audit activity by entity/action (C3.5) — which resources/actions are
 * touched most often in the window. Both `entity` and `action` are
 * populated on every single audit row by the choke-point design described
 * in `AuditLog`'s own schema comment — the most solidly-populated table in
 * the schema, arguably more reliable than any report reading business data.
 */
export async function getAuditActivityByEntity(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const rows = await prisma.auditLog.groupBy({
    by: ['entity', 'action'],
    where: { createdAt: { gte: start, lt: end } },
    _count: { _all: true },
  });

  return {
    range: { from: params.from, to: params.to },
    rows: rows
      .map((row) => ({ entity: row.entity, action: row.action, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * The report registry (C3.2/C3.3) — one place mapping a report KEY (the
 * same string the frontend's `ReportView` union and a `ScheduledReport.reportKey`
 * use) to how to fetch it and how to flatten it into CSV rows.
 *
 * ─── WHY THIS EXISTS, NOT JUST THE FUNCTIONS ABOVE ────────────────────
 * Before this, every route in reports.route.ts hand-wrote its own
 * `sendCsv(res, ..., [{header, value}, ...])` call — fine for one reader
 * (the browser), but the scheduler (C3.2) needs the exact same CSV a manual
 * export would produce, on a timer, with no request/response in the loop at
 * all. Duplicating the column mapping a second time for the scheduler would
 * be the two-copies-that-drift problem this file's own header comment
 * warns about elsewhere. One entry per report, read by both the route AND
 * the scheduler.
 *
 * `rows()` returns the flat array CSV wants (`overview` and `needsAttention`
 * wrap their single object in a 1-element array — same convention
 * `reports.route.ts`'s existing `overview` CSV branch already used before
 * this registry existed).
 */
export interface ReportRegistryEntry<T> {
  label: string;
  fetch: (params: RangeParams) => Promise<T>;
  rows: (result: T) => readonly unknown[];
  csvColumns: { header: string; value: (row: never) => string | number }[];
  /** Whether this report ignores its date range entirely (deliberately live
   *  state, like `getNeedsAttention`) — the scheduler skips these, since
   *  "yesterday's snapshot of right now" isn't a report worth mailing. */
  isRangeScoped: boolean;
}

/**
 * Captures `T` (the fetch result) and `R` (one CSV row) once per call so
 * each entry below is checked against its OWN result shape — assigning the
 * object literal directly to a `Record<string, ReportRegistryEntry<never>>`
 * would force every `rows`/`csvColumns` callback's parameter to `never` up
 * front and lose real inference entirely (the `never` in the exported type
 * exists so DIFFERENT entries can share one map's value type; it is not
 * meant to be written by hand at each entry).
 */
function entry<T, R>(e: {
  label: string;
  fetch: (params: RangeParams) => Promise<T>;
  rows: (result: T) => readonly R[];
  csvColumns: { header: string; value: (row: R) => string | number }[];
  isRangeScoped: boolean;
}): ReportRegistryEntry<never> {
  return e as unknown as ReportRegistryEntry<never>;
}

export const REPORT_REGISTRY: Record<string, ReportRegistryEntry<never>> = {
  overview: entry({
    label: 'Overview',
    fetch: getOverview,
    rows: (r) => [r],
    csvColumns: [
      { header: 'From', value: (r) => r.range.from },
      { header: 'To', value: (r) => r.range.to },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Canceled orders', value: (r) => r.canceledOrders },
      { header: 'New customers', value: (r) => r.newCustomers },
      { header: 'Low stock products', value: (r) => r.lowStockProducts },
      { header: 'Units sold', value: (r) => r.unitsSold },
      { header: 'Average order value', value: (r) => r.averageOrderValue },
    ],
    isRangeScoped: true,
  }),
  revenue: entry({
    label: 'Revenue over time',
    fetch: (params) => getRevenueSeries({ ...params, granularity: 'day' }),
    rows: (r) => r.points,
    csvColumns: [
      { header: 'Date', value: (r) => r.date },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
    ],
    isRangeScoped: true,
  }),
  'top-products': entry({
    label: 'Best sellers',
    fetch: (params) => getTopProducts({ ...params, limit: 10 }),
    rows: (r) => r.products,
    csvColumns: [
      { header: 'Product ID', value: (r) => r.productId ?? '' },
      { header: 'Name', value: (r) => r.name ?? '(deleted product)' },
      { header: 'Quantity', value: (r) => r.quantity },
      { header: 'Revenue', value: (r) => r.revenue },
    ],
    isRangeScoped: true,
  }),
  'status-breakdown': entry({
    label: 'Order outcomes',
    fetch: getStatusBreakdown,
    rows: (r) => r.statuses,
    csvColumns: [
      { header: 'Status', value: (r) => r.status },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Total', value: (r) => r.total },
    ],
    isRangeScoped: true,
  }),
  'fulfillment-health': entry({
    label: 'Fulfillment health',
    fetch: getFulfillmentHealth,
    rows: (r) => r.needsAttention,
    csvColumns: [
      { header: 'Order', value: (r) => r.orderNumber },
      { header: 'Status', value: (r) => r.status },
      { header: 'Hours in status', value: (r) => r.hoursInStatus },
    ],
    isRangeScoped: true,
  }),
  'returns-summary': entry({
    label: 'Returns summary',
    fetch: getReturnsSummary,
    rows: (r) => r.topReturnedProducts,
    csvColumns: [
      { header: 'Product ID', value: (r) => r.productId ?? '' },
      { header: 'Name', value: (r) => r.name ?? '(deleted product)' },
      { header: 'Units returned', value: (r) => r.unitsReturned },
      { header: 'Returns', value: (r) => r.returnCount },
    ],
    isRangeScoped: true,
  }),
  'order-value-distribution': entry({
    label: 'Order value distribution',
    fetch: getOrderValueDistribution,
    rows: (r) => r.buckets,
    csvColumns: [
      { header: 'Range', value: (r) => r.label },
      { header: 'Orders', value: (r) => r.count },
    ],
    isRangeScoped: true,
  }),
  'staff-activity': entry({
    label: 'Staff activity',
    fetch: getStaffActivity,
    rows: (r) => r.staff,
    csvColumns: [
      { header: 'Actor email', value: (r) => r.actorEmail },
      { header: 'Role', value: (r) => r.actorRole ?? '' },
      { header: 'Actions', value: (r) => r.actionCount },
      { header: 'Denied attempts', value: (r) => r.deniedCount },
    ],
    isRangeScoped: true,
  }),
  'category-breakdown': entry({
    label: 'Revenue by category',
    fetch: getCategoryBreakdown,
    rows: (r) => r.categories,
    csvColumns: [
      { header: 'Category', value: (r) => r.categoryName },
      { header: 'Units', value: (r) => r.units },
      { header: 'Revenue', value: (r) => r.revenue },
    ],
    isRangeScoped: true,
  }),
  'refund-rate-trend': entry({
    label: 'Refund rate trend',
    fetch: getRefundRateTrend,
    rows: (r) => r.points,
    csvColumns: [
      { header: 'Month', value: (r) => r.date },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Refunded', value: (r) => r.refunded },
      { header: 'Refund rate', value: (r) => (r.refundRate * 100).toFixed(2) + '%' },
    ],
    isRangeScoped: true,
  }),
  'inventory-turnover': entry({
    label: 'Inventory turnover',
    fetch: getInventoryTurnover,
    rows: (r) => r.turnover,
    csvColumns: [
      { header: 'Product', value: (r) => r.name },
      { header: 'SKU', value: (r) => r.sku ?? '' },
      { header: 'Current stock', value: (r) => r.stock },
      { header: 'Units sold', value: (r) => r.unitsSold },
    ],
    isRangeScoped: true,
  }),
};

export function isKnownReportKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(REPORT_REGISTRY, key);
}
