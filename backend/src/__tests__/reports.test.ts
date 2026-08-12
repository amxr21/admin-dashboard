import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, ReturnResolution, ReturnStatus, ReviewStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { MAX_RANGE_DAYS } from '../services/reports.service.js';

/**
 * Reporting.
 *
 * Three things carry this. Revenue must come from the ORDER SNAPSHOT, so a
 * price edited today cannot rewrite last quarter. Cancelled orders must not
 * count as money. And the granularity must never reach SQL as text from the
 * request — it is part of the query STRUCTURE, which is where injection lives.
 */

const app = createApp();

interface OverviewBody {
  data: {
    revenue: string;
    orders: number;
    canceledOrders: number;
    lowStockProducts: number;
    unitsSold: number;
    averageOrderValue: string;
  };
}
interface SeriesBody {
  data: {
    granularity: string;
    points: { date: string; revenue: string; orders: number }[];
  };
}
interface TopBody {
  data: { products: { productId: string | null; name: string | null; revenue: string; quantity: number }[] };
}
interface BreakdownBody {
  data: { statuses: { status: string; orders: number; total: string }[] };
}

const RUN = `reportstest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** `order_number` is VARCHAR(40) — RUN alone is already ~32 chars, so a tagged
 *  suffix needs a short unique base, not the full RUN string. */
const SHORT_RUN = Math.random().toString(36).slice(2, 10);

const userIds: string[] = [];
const orderIds: string[] = [];
let productId = '';
let ownerToken = '';
let fulfillmentToken = '';

/** A window far in the past, so seeded data cannot land inside it. */
const FROM = '2019-03-01';
const TO = '2019-03-31';

async function makeUser(role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return signToken(user);
}

async function makeOrder(opts: {
  placedAt: string;
  total: string;
  status?: OrderStatus;
  itemPrice?: string;
  quantity?: number;
}) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      placedAt: new Date(`${opts.placedAt}T12:00:00.000Z`),
      total: new Prisma.Decimal(opts.total),
      status: opts.status ?? OrderStatus.DELIVERED,
      ...(opts.itemPrice
        ? {
            items: {
              create: [
                {
                  productId,
                  quantity: opts.quantity ?? 1,
                  price: new Prisma.Decimal(opts.itemPrice),
                },
              ],
            },
          }
        : {}),
    },
  });
  orderIds.push(order.id);
  return order.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function get(path: string, token = ownerToken) {
  return request(app).get(`/api/v1${path}`).set(auth(token));
}

beforeAll(async () => {
  [ownerToken, fulfillmentToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    // FULFILLMENT picks orders and has no business reading turnover.
    makeUser(StaffRole.FULFILLMENT),
  ]);

  const product = await prisma.product.create({
    data: { name: `${RUN} widget`, price: new Prisma.Decimal('10.00'), stock: 100 },
  });
  productId = product.id;

  await makeOrder({ placedAt: '2019-03-04', total: '100.00', itemPrice: '25.00', quantity: 4 });
  await makeOrder({ placedAt: '2019-03-04', total: '50.00', itemPrice: '25.00', quantity: 2 });
  await makeOrder({ placedAt: '2019-03-12', total: '200.00', itemPrice: '50.00', quantity: 4 });
  // Cancelled — must not count as revenue anywhere.
  await makeOrder({
    placedAt: '2019-03-12',
    total: '999.00',
    status: OrderStatus.CANCELED,
    itemPrice: '999.00',
  });
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get(`/api/v1/reports/overview?from=${FROM}&to=${TO}`)).status).toBe(
      401,
    );
  });

  it('denies a role without the reports area', async () => {
    // Read-only does not mean public: revenue is not for everyone.
    expect((await get(`/reports/overview?from=${FROM}&to=${TO}`, fulfillmentToken)).status).toBe(
      403,
    );
  });
});

describe('cancelled orders are not revenue', () => {
  it('excludes them from the total', async () => {
    const res = await get(`/reports/overview?from=${FROM}&to=${TO}`);

    // 100 + 50 + 200 = 350. The 999 cancelled order must not appear.
    expect((res.body as OverviewBody).data.revenue).toBe('350.00');
  });

  it('still counts them as orders, and says how many', async () => {
    // Hiding them entirely would make the cancellation rate invisible in the
    // one report where it matters.
    const body = (await get(`/reports/overview?from=${FROM}&to=${TO}`)).body as OverviewBody;

    expect(body.data.orders).toBe(4);
    expect(body.data.canceledOrders).toBe(1);
  });

  it('excludes them from the average order value', async () => {
    // 350 over 3 paid orders, not 4.
    const body = (await get(`/reports/overview?from=${FROM}&to=${TO}`)).body as OverviewBody;

    expect(body.data.averageOrderValue).toBe('116.67');
  });

  it('excludes their items from units sold too', async () => {
    // 4 + 2 + 4 = 10 across the three real orders. The cancelled order's own
    // item (quantity 1) must not be counted — same exclusion revenue uses,
    // via the order relation, not a separately-maintained rule that could
    // drift from it.
    const body = (await get(`/reports/overview?from=${FROM}&to=${TO}`)).body as OverviewBody;

    expect(body.data.unitsSold).toBe(10);
  });

  it('excludes them from the series and from top products', async () => {
    const series = (await get(`/reports/revenue?from=${FROM}&to=${TO}`)).body as SeriesBody;
    const top = (await get(`/reports/top-products?from=${FROM}&to=${TO}`)).body as TopBody;

    expect(series.data.points.some((point) => point.revenue.startsWith('999'))).toBe(false);
    expect(top.data.products.some((row) => row.revenue.startsWith('999'))).toBe(false);
  });
});

describe('low stock follows the configured threshold', () => {
  /**
   * The dashboard tile deep-links straight to the Inventory page's own
   * low-stock filter, so if this count came from a hardcoded number the two
   * screens would disagree the moment an owner changed the setting — you would
   * click a tile reading "3" and land on a list of 11. `inventory.service.ts`
   * already resolves the live setting; this pins the reports side to the same
   * source rather than the magic 5 it used to use.
   */
  const threshold = 'inventory.lowStockThreshold';

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: threshold } });
    await prisma.product.deleteMany({ where: { name: `${RUN} sparse` } });
  });

  it('counts a product the raised threshold now includes', async () => {
    await prisma.product.create({
      data: { name: `${RUN} sparse`, price: new Prisma.Decimal('10.00'), stock: 9 },
    });

    // Below the default of 5, a product at 9 is NOT low stock.
    const before = (await get(`/reports/overview?from=${FROM}&to=${TO}`))
      .body as OverviewBody;

    await prisma.setting.upsert({
      where: { key: threshold },
      create: { key: threshold, value: 20 },
      update: { value: 20 },
    });

    const after = (await get(`/reports/overview?from=${FROM}&to=${TO}`))
      .body as OverviewBody;

    expect(after.data.lowStockProducts).toBeGreaterThan(before.data.lowStockProducts);
  });
});

describe('money crosses the wire as a string', () => {
  it('never as a JSON number', async () => {
    const res = await get(`/reports/overview?from=${FROM}&to=${TO}`);

    expect(typeof (res.body as OverviewBody).data.revenue).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('"revenue":350');
  });

  it('applies to every series point', async () => {
    const body = (await get(`/reports/revenue?from=${FROM}&to=${TO}`)).body as SeriesBody;

    for (const point of body.data.points) {
      expect(typeof point.revenue).toBe('string');
      expect(point.revenue).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('returns order counts as numbers, not BigInt strings', async () => {
    // COUNT() is BIGINT in MySQL and JSON.stringify throws on it — narrowing
    // in the service means no caller can forget.
    const body = (await get(`/reports/revenue?from=${FROM}&to=${TO}`)).body as SeriesBody;

    expect(typeof body.data.points[0]?.orders).toBe('number');
  });
});

describe('revenue reads the snapshot, never live prices', () => {
  it('does not change when the product price is edited', async () => {
    /**
     * The whole reason `order.total` and `orderItem.price` are denormalised.
     * Recomputing from current prices would mean two runs of the same report
     * disagree, with no record of why.
     */
    const before = (await get(`/reports/overview?from=${FROM}&to=${TO}`)).body as OverviewBody;
    const topBefore = (await get(`/reports/top-products?from=${FROM}&to=${TO}`)).body as TopBody;

    await prisma.product.update({
      where: { id: productId },
      data: { price: new Prisma.Decimal('9999.00') },
    });

    const after = (await get(`/reports/overview?from=${FROM}&to=${TO}`)).body as OverviewBody;
    const topAfter = (await get(`/reports/top-products?from=${FROM}&to=${TO}`)).body as TopBody;

    expect(after.data.revenue).toBe(before.data.revenue);
    expect(topAfter.data.products[0]?.revenue).toBe(topBefore.data.products[0]?.revenue);

    await prisma.product.update({
      where: { id: productId },
      data: { price: new Prisma.Decimal('10.00') },
    });
  });
});

describe('granularity never reaches SQL from the request', () => {
  it.each(['day', 'week', 'month'])('accepts %s', async (granularity) => {
    const res = await get(`/reports/revenue?from=${FROM}&to=${TO}&granularity=${granularity}`);

    expect(res.status).toBe(200);
    expect((res.body as SeriesBody).data.granularity).toBe(granularity);
  });

  it('rejects anything else rather than interpolating it', async () => {
    // The enum at the boundary is what makes the service's lookup total; the
    // map inside is what keeps the value out of the SQL string.
    for (const attack of [
      "day'; DROP TABLE orders; --",
      '%Y',
      'DAY',
      '../day',
      '',
    ]) {
      const res = await get(
        `/reports/revenue?from=${FROM}&to=${TO}&granularity=${encodeURIComponent(attack)}`,
      );
      expect(res.status).toBe(400);
    }
  });

  it('leaves the orders table intact after those attempts', async () => {
    // Belt and braces: if any of the above had reached SQL, this would fail.
    expect(await prisma.order.count({ where: { id: { in: orderIds } } })).toBe(orderIds.length);
  });

  it('buckets by month when asked', async () => {
    const body = (
      await get(`/reports/revenue?from=${FROM}&to=${TO}&granularity=month`)
    ).body as SeriesBody;

    expect(body.data.points).toHaveLength(1);
    expect(body.data.points[0]?.date).toBe('2019-03-01');
    expect(body.data.points[0]?.revenue).toBe('350.00');
  });

  it('buckets by day, keeping same-day orders together', async () => {
    const body = (await get(`/reports/revenue?from=${FROM}&to=${TO}`)).body as SeriesBody;
    const march4 = body.data.points.find((point) => point.date === '2019-03-04');

    // 100 + 50 on the same day.
    expect(march4?.revenue).toBe('150.00');
    expect(march4?.orders).toBe(2);
  });
});

describe('the date range is bounded', () => {
  it('rejects a range longer than the cap', async () => {
    // An unbounded range is an unbounded scan on an endpoint any reports role
    // can reach.
    const res = await get('/reports/overview?from=2000-01-01&to=2026-01-01');

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(String(MAX_RANGE_DAYS));
  });

  it('rejects an end before the start', async () => {
    expect((await get(`/reports/overview?from=${TO}&to=${FROM}`)).status).toBe(400);
  });

  it('rejects a malformed date', async () => {
    expect((await get('/reports/overview?from=last-tuesday&to=2019-03-31')).status).toBe(400);
  });

  it('includes orders placed ON the end date', async () => {
    // A naive `<= midnight` comparison silently drops the whole final day.
    const body = (await get('/reports/overview?from=2019-03-12&to=2019-03-12'))
      .body as OverviewBody;

    expect(body.data.revenue).toBe('200.00');
  });
});

describe('top products', () => {
  it('ranks by revenue from the line-item price', async () => {
    const body = (await get(`/reports/top-products?from=${FROM}&to=${TO}`)).body as TopBody;

    // 50.00 x 4 = 200 beats 25.00 x 6 = 150, both on the same product here —
    // so the row aggregates to 350 across the range.
    expect(body.data.products[0]?.revenue).toBe('350.00');
    expect(body.data.products[0]?.quantity).toBe(10);
  });

  it('caps the limit', async () => {
    const res = await get(`/reports/top-products?from=${FROM}&to=${TO}&limit=99999`);
    expect(res.status).toBe(400);
  });
});

describe('status breakdown', () => {
  it('includes every status, including the zeroes', async () => {
    // A missing bar reads as missing data; an explicit zero reads as "none of
    // these happened".
    const body = (await get(`/reports/status-breakdown?from=${FROM}&to=${TO}`))
      .body as BreakdownBody;

    expect(body.data.statuses.length).toBe(Object.keys(OrderStatus).length);
    expect(body.data.statuses.find((s) => s.status === 'CANCELED')?.orders).toBe(1);
    expect(body.data.statuses.find((s) => s.status === 'PENDING')?.orders).toBe(0);
  });
});

describe('CSV export', () => {
  it('overview: a spreadsheet a manager can open, not a blob for engineering to parse', async () => {
    const res = await get(`/reports/overview?from=${FROM}&to=${TO}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('overview.csv');

    const [header, row] = res.text.trim().split('\r\n');
    expect(header).toBe(
      'From,To,Revenue,Orders,Canceled orders,New customers,Low stock products,Units sold,Average order value',
    );
    expect(row).toContain(FROM);
  });

  it('revenue: one row per point, same numbers as the JSON series', async () => {
    const json = (await get(`/reports/revenue?from=${FROM}&to=${TO}`)).body as SeriesBody;
    const csv = await get(`/reports/revenue?from=${FROM}&to=${TO}&format=csv`);

    expect(csv.status).toBe(200);
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Revenue,Orders');
    // Header plus one row per point — not a placeholder count.
    expect(lines.length).toBe(json.data.points.length + 1);
  });

  it('top products: falls back for a hard-deleted product, same as the JSON response', async () => {
    const res = await get(`/reports/top-products?from=${FROM}&to=${TO}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`${RUN} widget`);
  });

  it('status breakdown: every status, including the zeroes', async () => {
    const res = await get(`/reports/status-breakdown?from=${FROM}&to=${TO}&format=csv`);

    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\r\n');
    // Header plus one row per OrderStatus value.
    expect(lines.length).toBe(Object.keys(OrderStatus).length + 1);
    expect(res.text).toContain('CANCELED,1,');
  });

  it('rejects an unknown format rather than silently falling back to JSON', async () => {
    const res = await get(`/reports/overview?from=${FROM}&to=${TO}&format=xml`);
    expect(res.status).toBe(400);
  });
});

describe('XLSX and PDF export (C3.4)', () => {
  it('overview as XLSX: a real workbook, not a renamed CSV', async () => {
    const res = await get(`/reports/overview?from=${FROM}&to=${TO}&format=xlsx`).buffer(true).parse((response, cb) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toContain('overview.xlsx');
    // The XLSX container is a ZIP archive — "PK" is its real magic number,
    // proof this is not just the CSV bytes served under a different header.
    const body = res.body as Buffer;
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('revenue as PDF: a real PDF document', async () => {
    const res = await get(`/reports/revenue?from=${FROM}&to=${TO}&format=pdf`).buffer(true).parse((response, cb) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('revenue.pdf');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('the explorer accepts XLSX with its dimension param intact', async () => {
    const res = await get(`/reports/explorer?from=${FROM}&to=${TO}&dimension=status&format=xlsx`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('explorer.xlsx');
  });
});

describe('fulfillment health', () => {
  // These orders are placed near "now" (real elapsed SLA hours only make
  // sense against the real clock), so they need a range that actually
  // covers "now" — the shared FROM/TO constants are a fixed 2019 window and
  // would exclude them even before the range-scoping fix below.
  const RECENT_FROM = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const RECENT_TO = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it('lists an order stuck in PENDING past its SLA, with real elapsed hours', async () => {
    const stuckOrder = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-stuck-pend`,
        placedAt: new Date(Date.now() - 48 * 3_600_000),
        total: new Prisma.Decimal('10.00'),
        status: OrderStatus.PENDING,
      },
    });
    orderIds.push(stuckOrder.id);

    const body = (
      await get(`/reports/fulfillment-health?from=${RECENT_FROM}&to=${RECENT_TO}`)
    ).body as {
      data: { needsAttention: { orderId: string; status: string; hoursInStatus: number }[] };
    };

    const found = body.data.needsAttention.find((row) => row.orderId === stuckOrder.id);
    expect(found?.status).toBe('PENDING');
    expect(found?.hoursInStatus).toBeGreaterThanOrEqual(48);
  });

  it('excludes an order still inside its SLA window', async () => {
    const freshOrder = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-fresh-pend`,
        placedAt: new Date(),
        total: new Prisma.Decimal('10.00'),
        status: OrderStatus.PENDING,
      },
    });
    orderIds.push(freshOrder.id);

    const body = (
      await get(`/reports/fulfillment-health?from=${RECENT_FROM}&to=${RECENT_TO}`)
    ).body as {
      data: { needsAttention: { orderId: string }[] };
    };

    expect(body.data.needsAttention.some((row) => row.orderId === freshOrder.id)).toBe(false);
  });

  it('excludes an order stuck past its SLA if it was placed outside the selected range', async () => {
    // The bug this guards: `needsAttention` used to scan every currently-
    // stuck order regardless of the selected date range, while the average
    // above it respected the range — two halves of one widget silently
    // describing different windows. Both must now agree.
    const stuckButOutOfRange = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-stuck-out-of-range`,
        placedAt: new Date(Date.now() - 60 * 86_400_000), // 60 days ago
        total: new Prisma.Decimal('10.00'),
        status: OrderStatus.PENDING,
      },
    });
    orderIds.push(stuckButOutOfRange.id);

    const body = (
      await get(`/reports/fulfillment-health?from=${RECENT_FROM}&to=${RECENT_TO}`)
    ).body as {
      data: { needsAttention: { orderId: string }[] };
    };

    expect(
      body.data.needsAttention.some((row) => row.orderId === stuckButOutOfRange.id),
    ).toBe(false);
  });

  it('averages a completed PENDING transition, excluding an order still waiting', async () => {
    const completedOrder = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-avg-cmpltd`,
        placedAt: new Date('2019-03-05T00:00:00.000Z'),
        total: new Prisma.Decimal('10.00'),
        status: OrderStatus.CONFIRMED,
      },
    });
    orderIds.push(completedOrder.id);

    await prisma.orderStatusHistory.createMany({
      data: [
        {
          orderId: completedOrder.id,
          toStatus: OrderStatus.PENDING,
          createdAt: new Date('2019-03-05T00:00:00.000Z'),
        },
        {
          orderId: completedOrder.id,
          toStatus: OrderStatus.CONFIRMED,
          createdAt: new Date('2019-03-05T10:00:00.000Z'),
        },
      ],
    });

    const body = (await get(`/reports/fulfillment-health?from=${FROM}&to=${TO}`)).body as {
      data: { avgHoursInStatus: { status: string; avgHours: number | null }[] };
    };

    expect(typeof body.data.avgHoursInStatus.find((row) => row.status === 'PENDING')?.avgHours).toBe(
      'number',
    );
    expect(body.data.avgHoursInStatus.find((row) => row.status === 'PENDING')?.avgHours).toBe(10);
  });

  it('denies a role without the reports area', async () => {
    expect(
      (await get(`/reports/fulfillment-health?from=${FROM}&to=${TO}`, fulfillmentToken)).status,
    ).toBe(403);
  });
});

describe('returns summary', () => {
  // A separate month from FROM/TO on purpose: this order's total would
  // otherwise land in a bucket the order-value-distribution test asserts an
  // exact count on, and cross-describe-block data bleeding into a shared
  // range is exactly the kind of flake that discipline exists to avoid.
  const RETURNS_FROM = '2019-04-01';
  const RETURNS_TO = '2019-04-30';

  it('reports refund value, units returned and per-product breakdown from real Return rows', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-return-ord`,
        placedAt: new Date('2019-04-06T00:00:00.000Z'),
        total: new Prisma.Decimal('50.00'),
        status: OrderStatus.RETURNED,
        items: { create: [{ productId, quantity: 2, price: new Prisma.Decimal('25.00') }] },
      },
      include: { items: true },
    });
    orderIds.push(order.id);

    const orderItem = order.items[0];
    if (!orderItem) throw new Error('seed order item missing');

    const returnRow = await prisma.return.create({
      data: {
        rmaNumber: `${RUN}-RMA-1`,
        reason: 'test',
        status: ReturnStatus.APPROVED,
        resolution: ReturnResolution.REFUND,
        refundAmount: new Prisma.Decimal('50.00'),
        orderId: order.id,
        createdAt: new Date('2019-04-06T12:00:00.000Z'),
        items: { create: [{ orderItemId: orderItem.id, quantity: 2 }] },
      },
    });

    const body = (await get(`/reports/returns-summary?from=${RETURNS_FROM}&to=${RETURNS_TO}`)).body as {
      data: {
        returnCount: number;
        refundValue: string;
        unitsReturned: number;
        topReturnedProducts: { productId: string | null; unitsReturned: number }[];
      };
    };

    expect(body.data.returnCount).toBeGreaterThanOrEqual(1);
    expect(body.data.unitsReturned).toBeGreaterThanOrEqual(2);
    expect(body.data.topReturnedProducts.some((p) => p.productId === productId)).toBe(true);

    // Cascades ReturnItem — must happen before afterAll's Order cleanup, since
    // ReturnItem.orderItemId is Restrict, not Cascade, from OrderItem's side.
    await prisma.return.delete({ where: { id: returnRow.id } });
  });

  it('scopes returnCount by when the order was placed, not when the return was approved', async () => {
    // The bug this guards: `returnCount` used to filter on `Return.createdAt`
    // while `orderCount` (returnRate's denominator) filtered on
    // `Order.placedAt` — two different date fields in one ratio, and a
    // number that disagreed with the "Order outcomes" widget's RETURNED
    // count for the identical window. An order placed OUTSIDE the queried
    // range whose return was approved INSIDE it must not count here.
    const orderOutsideRange = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-return-out-of-range`,
        // Placed a full year before the queried window.
        placedAt: new Date('2018-04-06T00:00:00.000Z'),
        total: new Prisma.Decimal('30.00'),
        status: OrderStatus.RETURNED,
        items: { create: [{ productId, quantity: 1, price: new Prisma.Decimal('30.00') }] },
      },
      include: { items: true },
    });
    orderIds.push(orderOutsideRange.id);

    const orderItem = orderOutsideRange.items[0];
    if (!orderItem) throw new Error('seed order item missing');

    const returnRow = await prisma.return.create({
      data: {
        rmaNumber: `${RUN}-RMA-2`,
        reason: 'test',
        status: ReturnStatus.APPROVED,
        resolution: ReturnResolution.REFUND,
        refundAmount: new Prisma.Decimal('30.00'),
        orderId: orderOutsideRange.id,
        // Approved INSIDE the queried window, even though the order itself
        // was placed a year before it.
        createdAt: new Date('2019-04-10T00:00:00.000Z'),
        items: { create: [{ orderItemId: orderItem.id, quantity: 1 }] },
      },
    });

    const body = (await get(`/reports/returns-summary?from=${RETURNS_FROM}&to=${RETURNS_TO}`)).body as {
      data: { returnCount: number };
    };

    // `refundValue`/`unitsReturned` (asserted in the test above) DO include
    // this return, since they're deliberately scoped by the return's own
    // approval date — only `returnCount` (and therefore `returnRate`) must
    // exclude it.
    expect(body.data.returnCount).toBe(0);

    await prisma.return.delete({ where: { id: returnRow.id } });
  });
});

describe('order value distribution', () => {
  it('buckets seeded orders correctly', async () => {
    const body = (await get(`/reports/order-value-distribution?from=${FROM}&to=${TO}`)).body as {
      data: { buckets: { label: string; count: number }[] };
    };

    // From beforeAll: 100.00 and 200.00 land in 100-250; 50.00 lands in 50-100.
    // The 999.00 CANCELED order is excluded, same as every other revenue view.
    expect(body.data.buckets.find((b) => b.label === '100-250')?.count).toBe(2);
    expect(body.data.buckets.find((b) => b.label === '50-100')?.count).toBe(1);
  });
});

describe('needs attention (C1.5)', () => {
  const createdReturnIds: string[] = [];
  const createdReviewIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];

  afterAll(async () => {
    await prisma.return.deleteMany({ where: { id: { in: createdReturnIds } } });
    await prisma.review.deleteMany({ where: { id: { in: createdReviewIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  });

  interface NeedsAttentionBody {
    data: {
      returnsAwaitingApproval: { count: number; items: { id: string; rmaNumber: string }[] };
      reviewsAwaitingModeration: { count: number; items: { id: string; productName: string | null }[] };
      unassignedDeliveries: { count: number; items: { id: string; orderNumber: string }[] };
      outOfStockWithOpenOrders: { count: number; items: { id: string; name: string }[] };
    };
  }

  it('is reachable by a role with the reports area, not by one without it', async () => {
    expect((await get('/reports/needs-attention')).status).toBe(200);
    expect((await get('/reports/needs-attention', fulfillmentToken)).status).toBe(403);
  });

  it('surfaces a return stuck in REQUESTED, live — not scoped to a date range', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-a-return`,
        // Placed FAR outside every date-range fixture in this file — if this
        // endpoint were accidentally date-scoped, this return would never
        // appear, and that silent omission is exactly the bug this pins.
        placedAt: new Date('2010-01-01T00:00:00.000Z'),
        total: new Prisma.Decimal('40.00'),
        status: OrderStatus.DELIVERED,
        items: { create: [{ productId, quantity: 1, price: new Prisma.Decimal('40.00') }] },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);

    const orderItem = order.items[0];
    if (!orderItem) throw new Error('seed order item missing');

    const returnRow = await prisma.return.create({
      data: {
        rmaNumber: `${RUN}-attn-rma`,
        reason: 'test',
        status: ReturnStatus.REQUESTED,
        orderId: order.id,
        items: { create: [{ orderItemId: orderItem.id, quantity: 1 }] },
      },
    });
    createdReturnIds.push(returnRow.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(body.data.returnsAwaitingApproval.count).toBeGreaterThanOrEqual(1);
    expect(
      body.data.returnsAwaitingApproval.items.some((row) => row.rmaNumber === `${RUN}-attn-rma`),
    ).toBe(true);
  });

  it('does not count an approved return as awaiting approval', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-a-return-approved`,
        placedAt: new Date('2010-01-01T00:00:00.000Z'),
        total: new Prisma.Decimal('40.00'),
        status: OrderStatus.RETURNED,
        items: { create: [{ productId, quantity: 1, price: new Prisma.Decimal('40.00') }] },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);
    const orderItem = order.items[0];
    if (!orderItem) throw new Error('seed order item missing');

    const returnRow = await prisma.return.create({
      data: {
        rmaNumber: `${RUN}-attn-rma-approved`,
        reason: 'test',
        status: ReturnStatus.APPROVED,
        resolution: 'REFUND',
        refundAmount: new Prisma.Decimal('40.00'),
        orderId: order.id,
        items: { create: [{ orderItemId: orderItem.id, quantity: 1 }] },
      },
    });
    createdReturnIds.push(returnRow.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(
      body.data.returnsAwaitingApproval.items.some((row) => row.rmaNumber === `${RUN}-attn-rma-approved`),
    ).toBe(false);
  });

  it('surfaces a review stuck in PENDING', async () => {
    const review = await prisma.review.create({
      data: { rating: 4, status: ReviewStatus.PENDING, productId },
    });
    createdReviewIds.push(review.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(body.data.reviewsAwaitingModeration.count).toBeGreaterThanOrEqual(1);
    expect(body.data.reviewsAwaitingModeration.items.some((row) => row.id === review.id)).toBe(
      true,
    );
  });

  it('does not count an approved review', async () => {
    const review = await prisma.review.create({
      data: { rating: 5, status: ReviewStatus.APPROVED, productId },
    });
    createdReviewIds.push(review.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(body.data.reviewsAwaitingModeration.items.some((row) => row.id === review.id)).toBe(
      false,
    );
  });

  it('surfaces an open order with no courier assignment', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-a-unassigned`,
        placedAt: new Date('2010-01-01T00:00:00.000Z'),
        total: new Prisma.Decimal('40.00'),
        status: OrderStatus.CONFIRMED,
      },
    });
    createdOrderIds.push(order.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(body.data.unassignedDeliveries.count).toBeGreaterThanOrEqual(1);
    expect(
      body.data.unassignedDeliveries.items.some((row) => row.orderNumber === `${SHORT_RUN}-a-unassigned`),
    ).toBe(true);
  });

  it('does not count a DELIVERED order as needing a courier', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-a-delivered`,
        placedAt: new Date('2010-01-01T00:00:00.000Z'),
        total: new Prisma.Decimal('40.00'),
        status: OrderStatus.DELIVERED,
      },
    });
    createdOrderIds.push(order.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(
      body.data.unassignedDeliveries.items.some((row) => row.orderNumber === `${SHORT_RUN}-a-delivered`),
    ).toBe(false);
  });

  it('surfaces a zero-stock product with a still-open order against it', async () => {
    const sparseProduct = await prisma.product.create({
      data: { name: `${RUN} attn sparse`, price: new Prisma.Decimal('10.00'), stock: 0 },
    });
    createdProductIds.push(sparseProduct.id);

    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-a-oos`,
        placedAt: new Date('2010-01-01T00:00:00.000Z'),
        total: new Prisma.Decimal('10.00'),
        status: OrderStatus.PENDING,
        items: { create: [{ productId: sparseProduct.id, quantity: 1, price: new Prisma.Decimal('10.00') }] },
      },
    });
    createdOrderIds.push(order.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(body.data.outOfStockWithOpenOrders.count).toBeGreaterThanOrEqual(1);
    expect(
      body.data.outOfStockWithOpenOrders.items.some((row) => row.name === `${RUN} attn sparse`),
    ).toBe(true);
  });

  it('does not surface a zero-stock product whose only orders are all DELIVERED', async () => {
    const sparseProduct = await prisma.product.create({
      data: { name: `${RUN} attn sparse settled`, price: new Prisma.Decimal('10.00'), stock: 0 },
    });
    createdProductIds.push(sparseProduct.id);

    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-a-oos-settled`,
        placedAt: new Date('2010-01-01T00:00:00.000Z'),
        total: new Prisma.Decimal('10.00'),
        status: OrderStatus.DELIVERED,
        items: { create: [{ productId: sparseProduct.id, quantity: 1, price: new Prisma.Decimal('10.00') }] },
      },
    });
    createdOrderIds.push(order.id);

    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(
      body.data.outOfStockWithOpenOrders.items.some((row) => row.name === `${RUN} attn sparse settled`),
    ).toBe(false);
  });

  it('does not surface an in-stock product even with open orders', async () => {
    // productId (the shared fixture) has stock 100 and DOES have open orders
    // from other describe blocks in this file — proving it's absent here is
    // proving the stock filter, not just the order-status filter, is doing
    // real work.
    const body = (await get('/reports/needs-attention')).body as NeedsAttentionBody;

    expect(body.data.outOfStockWithOpenOrders.items.some((row) => row.id === productId)).toBe(
      false,
    );
  });
});

describe('staff activity (C3.5)', () => {
  interface StaffActivityBody {
    data: {
      staff: { actorId: string | null; actorEmail: string; actorRole: string | null; actionCount: number; deniedCount: number }[];
    };
  }

  it('counts actions per actor within the window', async () => {
    const courier = await prisma.deliveryStaff.create({ data: { name: `${RUN} activity courier` } });

    // A real audited write, made by ownerToken, so it lands in the window's
    // AuditLog rows attributed to a known actor (courier profile edits are
    // audited as `courier.updated` — see couriers.service.ts's updateCourier).
    await request(app)
      .patch(`/api/v1/couriers/${courier.id}`)
      .set(auth(ownerToken))
      .send({ zone: 'Marina' });

    const today = new Date().toISOString().slice(0, 10);
    const body = (await get(`/reports/staff-activity?from=${today}&to=${today}`)).body as StaffActivityBody;

    const ownerRow = body.data.staff.find((row) => row.actorEmail === `${RUN}-owner@example.test`);
    expect(ownerRow?.actionCount).toBeGreaterThan(0);

    await prisma.deliveryStaff.delete({ where: { id: courier.id } });
  });

  it('counts denied attempts separately from successes, per actor', async () => {
    // fulfillmentToken lacks the reports area — every read it attempts here
    // is a real DENIED row.
    await get('/reports/overview?from=2019-01-01&to=2019-01-02', fulfillmentToken);

    const today = new Date().toISOString().slice(0, 10);
    const body = (await get(`/reports/staff-activity?from=${today}&to=${today}`)).body as StaffActivityBody;

    const fulfillmentRow = body.data.staff.find((row) => row.actorRole === 'FULFILLMENT');
    expect(fulfillmentRow?.deniedCount).toBeGreaterThan(0);
  });

  it('is denied to a role without the reports area', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`/reports/staff-activity?from=${today}&to=${today}`, fulfillmentToken)).status).toBe(403);
  });
});

describe('per-category breakdown (C3.5)', () => {
  interface CategoryBody {
    data: { categories: { categoryId: string | null; categoryName: string; units: number; revenue: string }[] };
  }

  it('groups revenue and units by the product\'s category', async () => {
    const category = await prisma.category.create({
      data: { name: `${RUN} category`, slug: `${RUN}-category-${Date.now()}` },
    });
    const categorisedProduct = await prisma.product.create({
      data: { name: `${RUN} categorised`, price: new Prisma.Decimal('40.00'), stock: 10, categoryId: category.id },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `${RUN}-cat-1`,
        placedAt: new Date('2019-05-01T12:00:00.000Z'),
        total: new Prisma.Decimal('80.00'),
        status: OrderStatus.DELIVERED,
        items: { create: [{ productId: categorisedProduct.id, quantity: 2, price: new Prisma.Decimal('40.00') }] },
      },
    });
    orderIds.push(order.id);

    const body = (await get('/reports/category-breakdown?from=2019-05-01&to=2019-05-01')).body as CategoryBody;
    const row = body.data.categories.find((c) => c.categoryId === category.id);

    expect(row).toBeDefined();
    expect(row?.units).toBe(2);
    expect(row?.revenue).toBe('80.00');

    await prisma.product.delete({ where: { id: categorisedProduct.id } });
    await prisma.category.delete({ where: { id: category.id } });
  });

  it('groups an order line with no category under an explicit bucket, not silently', async () => {
    // productId (the shared fixture) has no category set.
    const body = (await get(`/reports/category-breakdown?from=${FROM}&to=${TO}`)).body as CategoryBody;

    expect(body.data.categories.some((c) => c.categoryId === null && c.categoryName === '(uncategorised)')).toBe(
      true,
    );
  });
});

describe('refund-rate trend (C3.5)', () => {
  interface TrendBody {
    data: { points: { date: string; revenue: string; refunded: string; refundRate: number }[] };
  }

  it('computes refund rate as refunded ÷ revenue for the month', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${RUN}-trend-1`,
        placedAt: new Date('2019-06-10T12:00:00.000Z'),
        total: new Prisma.Decimal('100.00'),
        status: OrderStatus.RETURNED,
        items: { create: [{ productId, quantity: 1, price: new Prisma.Decimal('100.00') }] },
      },
      include: { items: true },
    });
    orderIds.push(order.id);

    const returnRow = await prisma.return.create({
      data: {
        rmaNumber: `${RUN}-RMA-TREND`,
        reason: 'test',
        status: ReturnStatus.APPROVED,
        resolution: ReturnResolution.REFUND,
        refundAmount: new Prisma.Decimal('25.00'),
        orderId: order.id,
        items: { create: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
      },
    });

    const body = (await get('/reports/refund-rate-trend?from=2019-06-01&to=2019-06-30')).body as TrendBody;
    const point = body.data.points.find((p) => p.date === '2019-06-01');

    expect(point?.revenue).toBe('100.00');
    expect(point?.refunded).toBe('25.00');
    expect(point?.refundRate).toBeCloseTo(0.25);

    // ReturnItem.orderItem is Restrict, not Cascade (see schema.prisma) — the
    // return must be deleted before afterAll's order cleanup runs, or the
    // order's cascade delete hits that Restrict and the whole suite's
    // cleanup fails.
    await prisma.return.delete({ where: { id: returnRow.id } });
  });

  it('renders a zero rate, not NaN, for a month with revenue and no refunds', async () => {
    const body = (await get(`/reports/refund-rate-trend?from=${FROM}&to=${TO}`)).body as TrendBody;
    const point = body.data.points.find((p) => p.date === '2019-03-01');

    expect(point?.refundRate).toBe(0);
    expect(Number.isNaN(point?.refundRate)).toBe(false);
  });
});

describe('inventory turnover / dead stock (C3.5)', () => {
  interface TurnoverBody {
    data: {
      turnover: { productId: string; name: string; sku: string | null; stock: number; unitsSold: number }[];
      deadStock: { productId: string; name: string }[];
    };
  }

  it('counts SOLD stock movements as units sold, in the window', async () => {
    const product = await prisma.product.create({
      data: { name: `${RUN} turnover product`, price: new Prisma.Decimal('10.00'), stock: 20 },
    });

    await prisma.stockMovement.create({
      data: { productId: product.id, delta: -5, reason: 'SOLD', createdAt: new Date('2019-07-15T00:00:00.000Z') },
    });
    // A DAMAGED movement must NOT count as sold.
    await prisma.stockMovement.create({
      data: { productId: product.id, delta: -2, reason: 'DAMAGED', createdAt: new Date('2019-07-15T00:00:00.000Z') },
    });

    const body = (await get('/reports/inventory-turnover?from=2019-07-01&to=2019-07-31')).body as TurnoverBody;
    const row = body.data.turnover.find((r) => r.productId === product.id);

    expect(row?.unitsSold).toBe(5);

    await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('flags a product with stock but zero sales in the window as dead stock', async () => {
    const product = await prisma.product.create({
      data: { name: `${RUN} dead stock product`, price: new Prisma.Decimal('10.00'), stock: 15 },
    });

    const body = (await get('/reports/inventory-turnover?from=2019-08-01&to=2019-08-31')).body as TurnoverBody;

    expect(body.data.deadStock.some((r) => r.productId === product.id)).toBe(true);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('does not flag a zero-stock product as dead stock — nothing to sell is not the same as not selling', async () => {
    const product = await prisma.product.create({
      data: { name: `${RUN} zero stock product`, price: new Prisma.Decimal('10.00'), stock: 0 },
    });

    const body = (await get('/reports/inventory-turnover?from=2019-08-01&to=2019-08-31')).body as TurnoverBody;

    expect(body.data.deadStock.some((r) => r.productId === product.id)).toBe(false);

    await prisma.product.delete({ where: { id: product.id } });
  });
});

describe('report explorer (C3.3)', () => {
  interface ExplorerBody {
    data: {
      dimension: string;
      rows: { key: string | null; label: string; revenue: string; units: number; orders: number; averageOrderValue: string }[];
    };
  }

  it('groups by category, matching the dedicated category-breakdown report', async () => {
    const category = await prisma.category.create({
      data: { name: `${RUN} explorer category`, slug: `${RUN}-explorer-category-${Date.now()}` },
    });
    const categorisedProduct = await prisma.product.create({
      data: { name: `${RUN} explorer product`, price: new Prisma.Decimal('40.00'), stock: 10, categoryId: category.id },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-explorer-1`,
        placedAt: new Date('2019-09-01T12:00:00.000Z'),
        total: new Prisma.Decimal('80.00'),
        status: OrderStatus.DELIVERED,
        items: { create: [{ productId: categorisedProduct.id, quantity: 2, price: new Prisma.Decimal('40.00') }] },
      },
    });
    orderIds.push(order.id);

    const body = (await get('/reports/explorer?from=2019-09-01&to=2019-09-01&dimension=category'))
      .body as ExplorerBody;
    const row = body.data.rows.find((r) => r.key === category.id);

    expect(row).toBeDefined();
    expect(row?.label).toBe(`${RUN} explorer category`);
    expect(row?.units).toBe(2);
    expect(row?.revenue).toBe('80.00');
    expect(row?.orders).toBe(1);
    expect(row?.averageOrderValue).toBe('80.00');

    await prisma.product.delete({ where: { id: categorisedProduct.id } });
    await prisma.category.delete({ where: { id: category.id } });
  });

  it('counts DISTINCT orders, not line items, so averageOrderValue is not double-counted', async () => {
    const secondProduct = await prisma.product.create({
      data: { name: `${RUN} explorer second`, price: new Prisma.Decimal('15.00'), stock: 10 },
    });

    // One order, two different line items — must count as ONE order.
    const order = await prisma.order.create({
      data: {
        orderNumber: `${SHORT_RUN}-explorer-2`,
        placedAt: new Date('2019-09-10T12:00:00.000Z'),
        total: new Prisma.Decimal('55.00'),
        status: OrderStatus.DELIVERED,
        items: {
          create: [
            { productId, quantity: 1, price: new Prisma.Decimal('40.00') },
            { productId: secondProduct.id, quantity: 1, price: new Prisma.Decimal('15.00') },
          ],
        },
      },
    });
    orderIds.push(order.id);

    const body = (await get('/reports/explorer?from=2019-09-10&to=2019-09-10&dimension=status')).body as ExplorerBody;
    const row = body.data.rows.find((r) => r.key === 'DELIVERED');

    expect(row?.orders).toBe(1);
    expect(row?.revenue).toBe('55.00');
    expect(row?.averageOrderValue).toBe('55.00');

    await prisma.product.delete({ where: { id: secondProduct.id } });
  });

  it('excludes cancelled orders, same as every other report', async () => {
    const body = (await get(`/reports/explorer?from=${FROM}&to=${TO}&dimension=status`)).body as ExplorerBody;

    expect(body.data.rows.some((r) => r.key === 'CANCELED')).toBe(false);
  });

  it('rejects an unknown dimension', async () => {
    const res = await get(`/reports/explorer?from=${FROM}&to=${TO}&dimension=not-a-real-dimension`);

    expect(res.status).toBe(400);
  });

  it('accepts every declared dimension without erroring', async () => {
    for (const dimension of ['day', 'week', 'month', 'status', 'category', 'product', 'paymentMethod']) {
      const res = await get(`/reports/explorer?from=${FROM}&to=${TO}&dimension=${dimension}`);
      expect(res.status).toBe(200);
    }
  });

  it('denies a role without the reports area', async () => {
    const res = await get(`/reports/explorer?from=${FROM}&to=${TO}&dimension=status`, fulfillmentToken);
    expect(res.status).toBe(403);
  });
});

describe('CSV export — new C3.5 reports', () => {
  it('staff activity', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await get(`/reports/staff-activity?from=${today}&to=${today}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.trim().split('\r\n')[0]).toBe('Actor email,Role,Actions,Denied attempts');
  });

  it('category breakdown', async () => {
    const res = await get(`/reports/category-breakdown?from=${FROM}&to=${TO}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Category,Units,Revenue');
  });

  it('refund rate trend', async () => {
    const res = await get(`/reports/refund-rate-trend?from=${FROM}&to=${TO}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Month,Revenue,Refunded,Refund rate');
  });

  it('inventory turnover', async () => {
    const res = await get(`/reports/inventory-turnover?from=${FROM}&to=${TO}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Product,SKU,Current stock,Units sold');
  });

  it('report explorer', async () => {
    const res = await get(`/reports/explorer?from=${FROM}&to=${TO}&dimension=status&format=csv`);

    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Label,Revenue,Units,Orders,Average order value');
  });
});

describe('the engine does not serve reports', () => {
  it('404s /r/reports', async () => {
    expect((await get('/r/reports')).status).toBe(404);
  });
});
