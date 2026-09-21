import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

const app = createApp();
const RUN = `branch-owned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let token = '';
let userId = '';
let businessId = '';
let branchA = '';
let branchB = '';
let customerId = '';
let productId = '';

const orderIds: string[] = [];
const returnIds: string[] = [];

function auth(branchId?: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...(branchId ? { 'X-Branch-Id': branchId } : {}),
  } as const;
}

async function makeOrder(branchId: string, status: OrderStatus) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      branchId,
      customerId,
      status,
      total: new Prisma.Decimal('10.00'),
      items: {
        create: [{ productId, quantity: 1, price: new Prisma.Decimal('10.00') }],
      },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  return order;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}@example.test`,
      name: `${RUN} owner`,
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userId = user.id;
  token = signToken(user);

  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessId = business.id;

  const [first, second] = await Promise.all([
    prisma.branch.create({
      data: { businessId, name: `${RUN} A`, timezone: 'Asia/Dubai' },
    }),
    prisma.branch.create({ data: { businessId, name: `${RUN} B` } }),
  ]);
  branchA = first.id;
  branchB = second.id;

  const customer = await prisma.customer.create({
    data: { name: `${RUN} customer`, email: `${RUN}-customer@example.test` },
  });
  customerId = customer.id;

  const product = await prisma.product.create({
    data: { name: `${RUN} product`, price: new Prisma.Decimal('10.00'), stock: 10 },
  });
  productId = product.id;
});

afterAll(async () => {
  await prisma.return.deleteMany({ where: { id: { in: returnIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.parkedSale.deleteMany({ where: { cashierId: userId } });
  await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.branchStock.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.delete({ where: { id: businessId } });
  await prisma.idempotencyRecord.deleteMany({ where: { actorId: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('branch-owned order operations', () => {
  it('hides foreign details, neighbors, timelines, notes, status changes, and refunds', async () => {
    const foreign = await makeOrder(branchB, OrderStatus.PENDING);

    const [detail, neighbors, timeline, status, note, refund] = await Promise.all([
      request(app).get(`/api/v1/orders/${foreign.id}`).set(auth(branchA)),
      request(app).get(`/api/v1/orders/${foreign.id}/neighbors`).set(auth(branchA)),
      request(app).get(`/api/v1/orders/${foreign.id}/timeline`).set(auth(branchA)),
      request(app)
        .patch(`/api/v1/orders/${foreign.id}/status`)
        .set(auth(branchA))
        .send({ to: OrderStatus.CONFIRMED }),
      request(app)
        .post(`/api/v1/orders/${foreign.id}/notes`)
        .set(auth(branchA))
        .send({ body: 'must not be written' }),
      request(app)
        .post(`/api/v1/orders/${foreign.id}/refund`)
        .set(auth(branchA))
        .send({ amount: '1.00', refundReason: 'CHANGED_MIND' }),
    ]);

    for (const response of [detail, neighbors, timeline, status, note, refund]) {
      expect(response.status).toBe(404);
    }

    const [order, noteCount, paymentCount] = await Promise.all([
      prisma.order.findUnique({ where: { id: foreign.id } }),
      prisma.orderNote.count({ where: { orderId: foreign.id } }),
      prisma.payment.count({ where: { orderId: foreign.id } }),
    ]);
    expect(order?.status).toBe(OrderStatus.PENDING);
    expect(noteCount).toBe(0);
    expect(paymentCount).toBe(0);
  });

  it('filters both bulk preview and bulk mutation to the active branch', async () => {
    const local = await makeOrder(branchA, OrderStatus.PENDING);
    const foreign = await makeOrder(branchB, OrderStatus.PENDING);

    const preview = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(auth(branchA))
      .send({ ids: [local.id, foreign.id], to: OrderStatus.CONFIRMED });

    expect(preview.status).toBe(200);
    const previewBody = preview.body as {
      data: { eligibleCount: number; ineligibleCount: number };
    };
    expect(previewBody.data).toMatchObject({ eligibleCount: 1, ineligibleCount: 1 });

    const changed = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(branchA))
      .send({ ids: [local.id, foreign.id], to: OrderStatus.CONFIRMED });

    expect(changed.status).toBe(200);
    const changedBody = changed.body as {
      data: { succeeded: string[]; skipped: { id: string; reason: string }[] };
    };
    expect(changedBody.data.succeeded).toEqual([local.id]);
    expect(changedBody.data.skipped).toEqual([
      { id: foreign.id, reason: 'Order not found' },
    ]);

    const rows = await prisma.order.findMany({
      where: { id: { in: [local.id, foreign.id] } },
      select: { id: true, status: true },
    });
    expect(rows.find((row) => row.id === local.id)?.status).toBe(OrderStatus.CONFIRMED);
    expect(rows.find((row) => row.id === foreign.id)?.status).toBe(OrderStatus.PENDING);
  });

  it('preserves an owner unscoped read when no branch is selected', async () => {
    const foreign = await makeOrder(branchB, OrderStatus.PENDING);
    const response = await request(app).get(`/api/v1/orders/${foreign.id}`).set(auth());
    expect(response.status).toBe(200);
  });

  it('interprets date-only list filters in the active branch timezone', async () => {
    const inside = await makeOrder(branchA, OrderStatus.PENDING);
    const outside = await makeOrder(branchA, OrderStatus.PENDING);

    const timezonePrefix = `tz${Date.now().toString(36)}`;
    await Promise.all([
      prisma.order.update({
        where: { id: inside.id },
        data: { orderNumber: `${timezonePrefix}-in`, placedAt: new Date('2026-09-19T21:00:00Z') },
      }),
      prisma.order.update({
        where: { id: outside.id },
        data: { orderNumber: `${timezonePrefix}-out`, placedAt: new Date('2026-09-20T20:30:00Z') },
      }),
    ]);

    const response = await request(app)
      .get('/api/v1/orders')
      .query({ from: '2026-09-20', to: '2026-09-20', search: timezonePrefix })
      .set(auth(branchA));

    expect(response.status).toBe(200);
    const body = response.body as { data: { orders: { id: string }[] } };
    expect(body.data.orders.map((order) => order.id)).toEqual([inside.id]);
  });
});

describe('branch-owned return operations', () => {
  async function makeReturnAt(branchId: string) {
    const order = await makeOrder(branchId, OrderStatus.DELIVERED);
    const created = await prisma.return.create({
      data: {
        rmaNumber: `RMA-${returnIds.length}-${Date.now()}`,
        reason: 'branch isolation',
        orderId: order.id,
        customerId,
        items: { create: [{ orderItemId: order.items[0]!.id, quantity: 1 }] },
      },
    });
    returnIds.push(created.id);
    return { order, created };
  }

  it('hides foreign detail, creation, approval, and rejection', async () => {
    const { order, created } = await makeReturnAt(branchB);

    const [detail, requested, approved, rejected] = await Promise.all([
      request(app).get(`/api/v1/returns/${created.id}`).set(auth(branchA)),
      request(app)
        .post('/api/v1/returns')
        .set(auth(branchA))
        .send({
          orderId: order.id,
          reason: 'foreign order',
          items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
        }),
      request(app)
        .post(`/api/v1/returns/${created.id}/approve`)
        .set(auth(branchA))
        .send({ resolution: 'STORE_CREDIT', restock: true }),
      request(app)
        .post(`/api/v1/returns/${created.id}/reject`)
        .set(auth(branchA))
        .send({ rejectionReason: 'must not be written' }),
    ]);

    for (const response of [detail, requested, approved, rejected]) {
      expect(response.status).toBe(404);
    }

    const [returnRow, orderRow, stock] = await Promise.all([
      prisma.return.findUnique({ where: { id: created.id } }),
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId, branchId: branchA } },
      }),
    ]);
    expect(returnRow?.status).toBe('REQUESTED');
    expect(orderRow?.status).toBe(OrderStatus.DELIVERED);
    expect(stock).toBeNull();
  });
});

describe('branch-owned POS operations', () => {
  it('does not void a sale from another branch', async () => {
    const foreign = await makeOrder(branchB, OrderStatus.CONFIRMED);
    await prisma.payment.create({
      data: { orderId: foreign.id, amount: new Prisma.Decimal('10.00'), method: 'cash' },
    });

    const response = await request(app)
      .post(`/api/v1/pos/orders/${foreign.id}/void`)
      .set(auth(branchA))
      .send({});

    expect(response.status).toBe(404);
    expect((await prisma.order.findUnique({ where: { id: foreign.id } }))?.status).toBe(
      OrderStatus.CONFIRMED,
    );
    expect(await prisma.payment.count({ where: { orderId: foreign.id } })).toBe(1);
  });

  it('does not resume or discard a parked cart from another branch', async () => {
    const parked = await prisma.parkedSale.create({
      data: {
        cashierId: userId,
        branchId: branchB,
        lines: [{ productId, quantity: 1 }],
      },
    });

    const resumed = await request(app)
      .post(`/api/v1/pos/parked/${parked.id}/resume`)
      .set(auth(branchA));
    const discarded = await request(app)
      .delete(`/api/v1/pos/parked/${parked.id}`)
      .set(auth(branchA));

    expect(resumed.status).toBe(404);
    expect(discarded.status).toBe(404);
    expect(await prisma.parkedSale.findUnique({ where: { id: parked.id } })).not.toBeNull();
  });

  it('uses the branch-local calendar date in the POS order number', async () => {
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId, branchId: branchA } },
      create: { productId, branchId: branchA, quantity: 10 },
      update: { quantity: 10 },
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-19T21:00:00Z'));

    try {
      const response = await request(app)
        .post('/api/v1/pos/checkout')
        .set(auth(branchA))
        .set('Idempotency-Key', randomUUID())
        .send({
          lines: [{ productId, quantity: 1 }],
          method: 'cash',
          tendered: '10.00',
        });

      expect(response.status).toBe(201);
      const body = response.body as { data: { orderNumber: string } };
      expect(body.data.orderNumber).toMatch(/^POS-20260920-/);
      orderIds.push((response.body as { data: { orderId: string } }).data.orderId);
    } finally {
      vi.useRealTimers();
    }
  });
});
