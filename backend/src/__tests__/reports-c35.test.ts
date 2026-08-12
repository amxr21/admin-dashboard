import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, ReturnResolution, ReturnStatus, ReviewStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * C3.5 (second batch) — 20 domain reports built after a schema inventory
 * confirmed each is honestly buildable (see `reports.service.ts`'s own
 * per-function doc comments for the write-path justification). What's worth
 * pinning per report: the field it claims to read is genuinely written by
 * real application logic, not just schema-possible; an absence (no cost, no
 * customer, no reviews) renders as an explicit bucket/exclusion rather than
 * a fabricated number; and every route is gated behind `requireArea('reports')`
 * like every other report.
 */

const app = createApp();

const RUN = `c35test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SHORT_RUN = Math.random().toString(36).slice(2, 10);

const userIds: string[] = [];
const orderIds: string[] = [];
const customerIds: string[] = [];
const productIds: string[] = [];
const reviewIds: string[] = [];
const returnIds: string[] = [];
const courierIds: string[] = [];
const assignmentIds: string[] = [];

let ownerToken = '';
let fulfillmentToken = '';

const FROM = '2019-04-01';
const TO = '2019-04-30';

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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function get(path: string, token = ownerToken) {
  return request(app).get(`/api/v1${path}`).set(auth(token));
}

let customerA = '';
let customerB = '';
let productWithCost = '';
let productNoCost = '';
let productNoReviews = '';
let courierId = '';

beforeAll(async () => {
  [ownerToken, fulfillmentToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.FULFILLMENT),
  ]);

  const custA = await prisma.customer.create({
    data: { name: `${RUN} customer A`, email: `${RUN}-a@example.test`, city: 'Testville', country: 'TC' },
  });
  const custB = await prisma.customer.create({
    data: { name: `${RUN} customer B`, email: `${RUN}-b@example.test`, city: 'Testville', country: 'TC' },
  });
  customerA = custA.id;
  customerB = custB.id;
  customerIds.push(custA.id, custB.id);

  const withCost = await prisma.product.create({
    data: { name: `${RUN} costed`, price: new Prisma.Decimal('50.00'), cost: new Prisma.Decimal('20.00'), stock: 100 },
  });
  const noCost = await prisma.product.create({
    data: { name: `${RUN} uncosted`, price: new Prisma.Decimal('30.00'), stock: 100 },
  });
  const unreviewed = await prisma.product.create({
    data: { name: `${RUN} unreviewed`, price: new Prisma.Decimal('10.00'), stock: 5 },
  });
  productWithCost = withCost.id;
  productNoCost = noCost.id;
  productNoReviews = unreviewed.id;
  productIds.push(withCost.id, noCost.id, unreviewed.id);

  // customerA: first order (new), then a second order (returning), same window.
  const orderA1 = await prisma.order.create({
    data: {
      orderNumber: `${SHORT_RUN}-a1`,
      placedAt: new Date('2019-04-05T10:00:00.000Z'),
      total: new Prisma.Decimal('50.00'),
      status: OrderStatus.DELIVERED,
      customerId: customerA,
      paymentMethod: 'card',
      items: { create: [{ productId: productWithCost, quantity: 1, price: new Prisma.Decimal('50.00') }] },
    },
    include: { items: true },
  });
  const orderA2 = await prisma.order.create({
    data: {
      orderNumber: `${SHORT_RUN}-a2`,
      placedAt: new Date('2019-04-15T10:00:00.000Z'),
      total: new Prisma.Decimal('30.00'),
      status: OrderStatus.DELIVERED,
      customerId: customerA,
      paymentMethod: 'cash',
      items: { create: [{ productId: productNoCost, quantity: 1, price: new Prisma.Decimal('30.00') }] },
    },
  });
  // customerB: single order in window (new).
  const orderB1 = await prisma.order.create({
    data: {
      orderNumber: `${SHORT_RUN}-b1`,
      placedAt: new Date('2019-04-10T10:00:00.000Z'),
      total: new Prisma.Decimal('80.00'),
      status: OrderStatus.DELIVERED,
      customerId: customerB,
      paymentMethod: 'card',
      items: { create: [{ productId: productWithCost, quantity: 1, price: new Prisma.Decimal('80.00') }] },
    },
  });
  // Guest order — no customerId.
  const orderGuest = await prisma.order.create({
    data: {
      orderNumber: `${SHORT_RUN}-guest`,
      placedAt: new Date('2019-04-12T10:00:00.000Z'),
      total: new Prisma.Decimal('20.00'),
      status: OrderStatus.DELIVERED,
      items: { create: [{ productId: productNoCost, quantity: 1, price: new Prisma.Decimal('20.00') }] },
    },
  });
  orderIds.push(orderA1.id, orderA2.id, orderB1.id, orderGuest.id);

  const review = await prisma.review.create({
    data: {
      productId: productWithCost,
      customerId: customerA,
      rating: 5,
      status: ReviewStatus.APPROVED,
      createdAt: new Date('2019-04-06T00:00:00.000Z'),
      updatedAt: new Date('2019-04-07T00:00:00.000Z'),
    },
  });
  reviewIds.push(review.id);

  const returnRow = await prisma.return.create({
    data: {
      rmaNumber: `${SHORT_RUN}-RMA1`,
      reason: 'Arrived damaged in transit',
      status: ReturnStatus.APPROVED,
      resolution: ReturnResolution.REFUND,
      refundAmount: new Prisma.Decimal('10.00'),
      orderId: orderA1.id,
      createdAt: new Date('2019-04-08T00:00:00.000Z'),
      items: { create: [{ orderItemId: orderA1.items[0]!.id, quantity: 1 }] },
    },
  });
  returnIds.push(returnRow.id);

  const courier = await prisma.deliveryStaff.create({
    data: { name: `${RUN} courier`, zone: 'North', region: 'NR', status: 'ACTIVE' },
  });
  courierId = courier.id;
  courierIds.push(courier.id);

  const assignment = await prisma.deliveryAssignment.create({
    data: {
      orderId: orderA1.id,
      driverId: courier.id,
      status: 'DELIVERED',
      total: new Prisma.Decimal('50.00'),
      createdAt: new Date('2019-04-05T10:00:00.000Z'),
      updatedAt: new Date('2019-04-06T10:00:00.000Z'),
    },
  });
  assignmentIds.push(assignment.id);
});

afterAll(async () => {
  await prisma.deliveryAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
  await prisma.deliveryStaff.deleteMany({ where: { id: { in: courierIds } } });
  await prisma.return.deleteMany({ where: { id: { in: returnIds } } });
  await prisma.review.deleteMany({ where: { id: { in: reviewIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('customer geography', () => {
  it('groups revenue by customer city/country', async () => {
    const body = (
      await get(`/reports/customer-geography?from=${FROM}&to=${TO}`)
    ).body as { data: { rows: { city: string; country: string; revenue: string; orders: number }[] } };

    const row = body.data.rows.find((r) => r.city === 'Testville');
    expect(row).toBeDefined();
    expect(row?.orders).toBe(3); // orderA1, orderA2, orderB1 all have Testville customers
  });

  it('buckets a guest order under "(unknown)"', async () => {
    const body = (
      await get(`/reports/customer-geography?from=${FROM}&to=${TO}`)
    ).body as { data: { rows: { city: string; orders: number }[] } };

    expect(body.data.rows.some((r) => r.city === '(unknown)')).toBe(true);
  });
});

describe('new vs returning customers', () => {
  it('classifies a customer\'s SECOND order in-window as returning', async () => {
    const body = (await get(`/reports/customer-new-vs-returning?from=${FROM}&to=${TO}`)).body as {
      data: { new: { revenue: string; orders: number }; returning: { revenue: string; orders: number } };
    };

    // new: orderA1 (customerA's first ever), orderB1 (customerB's first ever), orderGuest (no customer) = 3
    // returning: orderA2 (customerA's second) = 1
    expect(body.data.new.orders).toBe(3);
    expect(body.data.returning.orders).toBe(1);
    expect(body.data.returning.revenue).toBe('30.00');
  });
});

describe('customer lifetime value', () => {
  it('ranks customers by all-time revenue, not windowed', async () => {
    // limit=100 (the max) — the default top-20 is computed across every real
    // customer in this shared dev DB, and this fixture's $80 all-time spend
    // is not guaranteed to place in the top 20 alongside seeded customers
    // with much larger histories. A high limit guarantees the fixture
    // customer is included without asserting anything about rank/position.
    const body = (await get('/reports/customer-lifetime-value?limit=100')).body as {
      data: { customers: { customerId: string; revenue: string; orders: number; averageOrderValue: string }[] };
    };

    const rowA = body.data.customers.find((c) => c.customerId === customerA);
    expect(rowA).toBeDefined();
    expect(rowA?.orders).toBe(2);
    expect(rowA?.revenue).toBe('80.00');
    expect(rowA?.averageOrderValue).toBe('40.00');
  });

  it('respects a custom limit', async () => {
    const body = (await get('/reports/customer-lifetime-value?limit=1')).body as {
      data: { customers: unknown[] };
    };
    expect(body.data.customers.length).toBe(1);
  });
});

describe('customer order frequency', () => {
  it('buckets customerA under 2 orders and excludes the guest order entirely', async () => {
    const body = (await get(`/reports/customer-order-frequency?from=${FROM}&to=${TO}`)).body as {
      data: { buckets: { label: string; customers: number }[]; totalCustomers: number; repeatRate: number };
    };

    const bucket2 = body.data.buckets.find((b) => b.label === '2');
    expect(bucket2?.customers).toBeGreaterThanOrEqual(1);
    // Guest order has no customer, so totalCustomers counts only real ones (A + B, at minimum).
    expect(body.data.totalCustomers).toBeGreaterThanOrEqual(2);
  });
});

describe('guest vs registered orders', () => {
  it('separates the guest order from customer-linked ones', async () => {
    const body = (await get(`/reports/guest-vs-registered?from=${FROM}&to=${TO}`)).body as {
      data: { guest: { orders: number; revenue: string }; registered: { orders: number } };
    };

    expect(body.data.guest.orders).toBe(1);
    expect(body.data.guest.revenue).toBe('20.00');
    expect(body.data.registered.orders).toBe(3);
  });
});

describe('payment method breakdown', () => {
  it('groups by paymentMethod, with an explicit bucket for unset', async () => {
    const body = (await get(`/reports/payment-method-breakdown?from=${FROM}&to=${TO}`)).body as {
      data: { methods: { paymentMethod: string; orders: number }[] };
    };

    expect(body.data.methods.find((m) => m.paymentMethod === 'card')?.orders).toBe(2);
    expect(body.data.methods.find((m) => m.paymentMethod === 'cash')?.orders).toBe(1);
    // Guest order has no paymentMethod set either, in this fixture.
    expect(body.data.methods.some((m) => m.paymentMethod === '(not recorded)')).toBe(true);
  });
});

describe('product margin', () => {
  it('computes revenue, COGS and margin only for products WITH a recorded cost', async () => {
    const body = (await get(`/reports/product-margin?from=${FROM}&to=${TO}`)).body as {
      data: {
        products: { productId: string; revenue: string; cogs: string; margin: string; marginPercent: number }[];
        productsWithoutCost: number;
      };
    };

    const row = body.data.products.find((p) => p.productId === productWithCost);
    expect(row).toBeDefined();
    // orderA1 (50.00) + orderB1 (80.00) = 130.00 revenue; cost 20.00 * 2 units = 40.00 COGS.
    expect(row?.revenue).toBe('130.00');
    expect(row?.cogs).toBe('40.00');
    expect(row?.margin).toBe('90.00');

    // productNoCost sold in this window but must NOT appear in `products`.
    expect(body.data.products.some((p) => p.productId === productNoCost)).toBe(false);
    expect(body.data.productsWithoutCost).toBeGreaterThanOrEqual(1);
  });
});

describe('product review summary', () => {
  it('includes only APPROVED reviews, with a real distribution', async () => {
    const body = (await get(`/reports/product-review-summary?from=${FROM}&to=${TO}`)).body as {
      data: { products: { productId: string; reviewCount: number; averageRating: number; distribution: Record<string, number> }[] };
    };

    const row = body.data.products.find((p) => p.productId === productWithCost);
    expect(row).toBeDefined();
    expect(row?.reviewCount).toBe(1);
    expect(row?.averageRating).toBe(5);
    expect(row?.distribution['5']).toBe(1);
  });
});

describe('review moderation throughput', () => {
  it('counts the approved review and computes hours-to-moderation', async () => {
    const body = (await get(`/reports/review-moderation-throughput?from=${FROM}&to=${TO}`)).body as {
      data: { submitted: number; approved: number; pending: number; averageHoursToModeration: number | null };
    };

    expect(body.data.approved).toBeGreaterThanOrEqual(1);
    expect(body.data.averageHoursToModeration).not.toBeNull();
  });
});

describe('products without reviews', () => {
  it('lists the unreviewed product but not the reviewed one', async () => {
    const body = (await get('/reports/products-without-reviews')).body as {
      data: { products: { productId: string }[] };
    };

    expect(body.data.products.some((p) => p.productId === productNoReviews)).toBe(true);
    expect(body.data.products.some((p) => p.productId === productWithCost)).toBe(false);
  });
});

describe('low stock snapshot', () => {
  it('includes the low-stock unreviewed product (stock: 5)', async () => {
    const body = (await get('/reports/low-stock-snapshot')).body as {
      data: { threshold: number; products: { productId: string; stock: number }[] };
    };

    const row = body.data.products.find((p) => p.productId === productNoReviews);
    // Only asserts presence if stock actually falls at/under the live threshold —
    // the threshold itself is read live, not assumed to be the schema default.
    if (body.data.threshold >= 5) {
      expect(row).toBeDefined();
    }
  });
});

describe('stock adjustment reasons', () => {
  it('does not throw and returns a real shape', async () => {
    const res = await get(`/reports/stock-adjustment-reasons?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { data: { reasons: unknown[] } }).data.reasons)).toBe(true);
  });
});

describe('variant stock movement', () => {
  it('does not throw and returns a real shape', async () => {
    const res = await get(`/reports/variant-stock-movement?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { data: { variants: unknown[] } }).data.variants)).toBe(true);
  });
});

describe('return resolution breakdown', () => {
  it('counts the approved REFUND return', async () => {
    const body = (await get(`/reports/return-resolution-breakdown?from=${FROM}&to=${TO}`)).body as {
      data: { byResolution: { resolution: string; count: number; refundedValue: string }[] };
    };

    const row = body.data.byResolution.find((r) => r.resolution === 'REFUND');
    expect(row).toBeDefined();
    expect(row?.count).toBe(1);
    expect(row?.refundedValue).toBe('10.00');
  });
});

describe('return reasons', () => {
  it('exports the real reason text, not a fabricated category', async () => {
    const body = (await get(`/reports/return-reasons?from=${FROM}&to=${TO}`)).body as {
      data: { returns: { reason: string; rmaNumber: string }[] };
    };

    expect(body.data.returns.some((r) => r.reason === 'Arrived damaged in transit')).toBe(true);
  });
});

describe('courier performance', () => {
  it('counts the DELIVERED assignment for the courier', async () => {
    const body = (await get(`/reports/courier-performance?from=${FROM}&to=${TO}`)).body as {
      data: { couriers: { driverId: string; total: number; byStatus: Record<string, number> }[] };
    };

    const row = body.data.couriers.find((c) => c.driverId === courierId);
    expect(row).toBeDefined();
    expect(row?.byStatus['DELIVERED']).toBe(1);
  });
});

describe('delivery zone breakdown', () => {
  it('groups by the courier\'s own zone/region', async () => {
    const body = (await get(`/reports/delivery-zone-breakdown?from=${FROM}&to=${TO}`)).body as {
      data: { zones: { zone: string; region: string; assignments: number; collectibleValue: string }[] };
    };

    const row = body.data.zones.find((z) => z.zone === 'North');
    expect(row).toBeDefined();
    expect(row?.region).toBe('NR');
    expect(row?.assignments).toBe(1);
    expect(row?.collectibleValue).toBe('50.00');
  });
});

describe('delivery cycle time', () => {
  it('computes hours from assignment creation to its DELIVERED updatedAt', async () => {
    const body = (await get(`/reports/delivery-cycle-time?from=${FROM}&to=${TO}`)).body as {
      data: { deliveredCount: number; averageHours: number | null };
    };

    expect(body.data.deliveredCount).toBeGreaterThanOrEqual(1);
    // Fixture: createdAt 10:00, updatedAt (delivered) next day 10:00 = 24 hours.
    expect(body.data.averageHours).toBe(24);
  });
});

describe('courier workload snapshot', () => {
  it('is live state — reflects the courier just created', async () => {
    const body = (await get('/reports/courier-workload-snapshot')).body as {
      data: { couriers: { driverId: string; status: string }[] };
    };

    expect(body.data.couriers.some((c) => c.driverId === courierId)).toBe(true);
  });
});

describe('audit outcome trend', () => {
  it('does not throw and returns a real shape', async () => {
    const res = await get(`/reports/audit-outcome-trend?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { data: { points: unknown[] } }).data.points)).toBe(true);
  });
});

describe('audit activity by entity', () => {
  it('does not throw and returns a real shape', async () => {
    const res = await get(`/reports/audit-activity-by-entity?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { data: { rows: unknown[] } }).data.rows)).toBe(true);
  });
});

describe('authorisation — every new route requires the reports area', () => {
  const routes = [
    `/reports/customer-geography?from=${FROM}&to=${TO}`,
    `/reports/customer-new-vs-returning?from=${FROM}&to=${TO}`,
    '/reports/customer-lifetime-value',
    `/reports/customer-order-frequency?from=${FROM}&to=${TO}`,
    `/reports/guest-vs-registered?from=${FROM}&to=${TO}`,
    `/reports/payment-method-breakdown?from=${FROM}&to=${TO}`,
    `/reports/product-margin?from=${FROM}&to=${TO}`,
    `/reports/product-review-summary?from=${FROM}&to=${TO}`,
    `/reports/review-moderation-throughput?from=${FROM}&to=${TO}`,
    '/reports/products-without-reviews',
    '/reports/low-stock-snapshot',
    `/reports/stock-adjustment-reasons?from=${FROM}&to=${TO}`,
    `/reports/variant-stock-movement?from=${FROM}&to=${TO}`,
    `/reports/return-resolution-breakdown?from=${FROM}&to=${TO}`,
    `/reports/return-reasons?from=${FROM}&to=${TO}`,
    `/reports/courier-performance?from=${FROM}&to=${TO}`,
    `/reports/delivery-zone-breakdown?from=${FROM}&to=${TO}`,
    `/reports/delivery-cycle-time?from=${FROM}&to=${TO}`,
    '/reports/courier-workload-snapshot',
    `/reports/audit-outcome-trend?from=${FROM}&to=${TO}`,
    `/reports/audit-activity-by-entity?from=${FROM}&to=${TO}`,
  ];

  it.each(routes)('denies %s to a role without the reports area', async (route) => {
    const res = await get(route, fulfillmentToken);
    expect(res.status).toBe(403);
  });

  it.each(routes)('rejects an unauthenticated request to %s', async (route) => {
    const res = await request(app).get(`/api/v1${route}`);
    expect(res.status).toBe(401);
  });
});

describe('CSV export — every new route', () => {
  const rangedRoutes = [
    ['customer-geography', 'City,Country,Revenue,Orders'],
    ['customer-order-frequency', 'Orders placed,Customers'],
    ['payment-method-breakdown', 'Payment method,Revenue,Orders'],
    ['product-margin', 'Product,SKU,Revenue,COGS,Margin,Margin %,Units'],
    ['product-review-summary', 'Product,Reviews,Average rating,1 star,2 star,3 star,4 star,5 star'],
    ['stock-adjustment-reasons', 'Reason,Movements,Net units'],
    ['variant-stock-movement', 'Product,Variant,SKU,Current stock,Units sold,Units received'],
    ['return-resolution-breakdown', 'Resolution,Count,Refunded value'],
    ['return-reasons', 'RMA,Status,Reason,Requested at'],
    ['courier-performance', 'Courier,Total assignments,Delivered,Out for delivery,Canceled,Returned'],
    ['delivery-zone-breakdown', 'Zone,Region,Assignments,Collectible value'],
    ['audit-outcome-trend', 'Date,Success,Denied,Error'],
    ['audit-activity-by-entity', 'Entity,Action,Count'],
  ] as const;

  it.each(rangedRoutes)('%s exports the expected header row', async (route, header) => {
    const res = await get(`/reports/${route}?from=${FROM}&to=${TO}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.trim().split('\r\n')[0]).toBe(header);
  });

  it('low-stock-snapshot exports (no range params)', async () => {
    const res = await get('/reports/low-stock-snapshot?format=csv');
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Product,SKU,Stock,Days since last restock');
  });

  it('customer-lifetime-value exports (no range params)', async () => {
    const res = await get('/reports/customer-lifetime-value?format=csv');
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Customer,Email,Revenue,Orders,Average order value');
  });

  it('customer-new-vs-returning exports its single summary row', async () => {
    const res = await get(`/reports/customer-new-vs-returning?from=${FROM}&to=${TO}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('New — revenue,New — orders,Returning — revenue,Returning — orders');
  });

  it('guest-vs-registered exports its single summary row', async () => {
    const res = await get(`/reports/guest-vs-registered?from=${FROM}&to=${TO}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Guest — revenue,Guest — orders,Registered — revenue,Registered — orders');
  });

  it('delivery-cycle-time exports its single summary row', async () => {
    const res = await get(`/reports/delivery-cycle-time?from=${FROM}&to=${TO}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Delivered count,Average hours,Median hours');
  });

  it('review-moderation-throughput exports its single summary row', async () => {
    const res = await get(`/reports/review-moderation-throughput?from=${FROM}&to=${TO}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\r\n')[0]).toBe('Submitted,Approved,Rejected,Pending,Avg. hours to moderation');
  });
});
