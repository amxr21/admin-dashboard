import { OrderStatus, Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

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

  const [revenue, orderCount, canceledCount, customerCount, lowStock] =
    await prisma.$transaction([
      prisma.order.aggregate({ where: revenueWhere, _sum: { total: true } }),
      prisma.order.count({ where: inRange }),
      prisma.order.count({ where: { ...inRange, status: OrderStatus.CANCELED } }),
      prisma.customer.count({ where: { createdAt: { gte: start, lt: end } } }),
      prisma.product.count({ where: { stock: { lte: 5 } } }),
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
    WHERE status = 'PENDING' AND placed_at < ${new Date(Date.now() - PENDING_SLA_HOURS * 3_600_000)}
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
    WHERE o.status = 'CONFIRMED' AND h.enteredAt < ${new Date(Date.now() - CONFIRMED_SLA_HOURS * 3_600_000)}
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
 */
export async function getReturnsSummary(params: RangeParams) {
  const { start, end } = resolveRange(params);

  const inRange = { createdAt: { gte: start, lt: end } };

  const [returnCount, orderCount, refundAgg, unitsAgg, byProduct] = await prisma.$transaction([
    prisma.return.count({ where: inRange }),
    prisma.order.count({ where: { placedAt: { gte: start, lt: end } } }),
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
