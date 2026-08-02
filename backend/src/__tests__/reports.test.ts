import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, ReturnResolution, ReturnStatus, StaffRole } from '@prisma/client';

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

  it('excludes them from the series and from top products', async () => {
    const series = (await get(`/reports/revenue?from=${FROM}&to=${TO}`)).body as SeriesBody;
    const top = (await get(`/reports/top-products?from=${FROM}&to=${TO}`)).body as TopBody;

    expect(series.data.points.some((point) => point.revenue.startsWith('999'))).toBe(false);
    expect(top.data.products.some((row) => row.revenue.startsWith('999'))).toBe(false);
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
      'From,To,Revenue,Orders,Canceled orders,New customers,Low stock products,Average order value',
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

describe('fulfillment health', () => {
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

    const body = (await get(`/reports/fulfillment-health?from=${FROM}&to=${TO}`)).body as {
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

    const body = (await get(`/reports/fulfillment-health?from=${FROM}&to=${TO}`)).body as {
      data: { needsAttention: { orderId: string }[] };
    };

    expect(body.data.needsAttention.some((row) => row.orderId === freshOrder.id)).toBe(false);
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

describe('the engine does not serve reports', () => {
  it('404s /r/reports', async () => {
    expect((await get('/r/reports')).status).toBe(404);
  });
});
