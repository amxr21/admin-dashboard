import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { waitFor } from './helpers/wait-for.js';

/**
 * Returns / RMA.
 *
 * The interesting behaviour is entirely in `approveReturn`: it is the one
 * place an order's status, its history, a possible restock, and the return's
 * own resolution all have to land together — so these tests lean on that
 * transaction rather than on CRUD plumbing the generic engine already proves
 * elsewhere.
 */

const app = createApp();

interface ReturnBody {
  data: {
    return: {
      id: string;
      rmaNumber: string;
      status: string;
      resolution: string;
      category: string | null;
      refundAmount: string | null;
      restocked: boolean;
      rejectionReason: string | null;
      order: { id: string; status?: OrderStatus };
      items: { orderItemId: string; quantity: number }[];
    };
  };
}
interface ErrorBody {
  error: { code: string; message: string; details?: { available?: number; max?: string } };
}

const RUN = `returnstest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const orderIds: string[] = [];
const productIds: string[] = [];
let customerId = '';
let ownerToken = '';
let demoToken = '';
let supportToken = '';

async function makeUser(role: StaffRole, tag = role.toLowerCase()) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return { token: signToken(user), id: user.id };
}

async function makeProduct(stock = 10) {
  const product = await prisma.product.create({
    data: { name: `${RUN} widget ${productIds.length}`, price: new Prisma.Decimal('25.00'), stock },
  });
  productIds.push(product.id);
  return product.id;
}

/** An order with one line item of the given quantity, at the given status. */
async function makeOrder(status: OrderStatus, quantity = 4) {
  const productId = await makeProduct();

  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      status,
      total: new Prisma.Decimal('25.00').mul(quantity),
      customerId,
      items: { create: [{ productId, quantity, price: new Prisma.Decimal('25.00') }] },
    },
    include: { items: true },
  });
  orderIds.push(order.id);

  return { orderId: order.id, orderItemId: order.items[0]!.id, productId };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

/** For an assertion expecting nothing to have landed — nothing to poll for. */
function waitForNoWrite() {
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

beforeAll(async () => {
  const [owner, demo, support] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.DEMO, 'demo'),
    makeUser(StaffRole.SUPPORT, 'support'),
  ]);
  ownerToken = owner.token;
  demoToken = demo.token;
  supportToken = support.token;

  const customer = await prisma.customer.create({
    data: { name: `${RUN} customer`, email: `${RUN}@example.test` },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.return.deleteMany({ where: { order: { id: { in: orderIds } } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.notification.deleteMany({
    where: { type: 'return.requested', body: { contains: RUN } },
  });
  await prisma.setting.deleteMany({ where: { key: 'notifications.returnRequestAlerts' } });
  await prisma.$disconnect();
});

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get('/api/v1/returns')).status).toBe(401);
  });

  it('lets a granted role read', async () => {
    expect((await request(app).get('/api/v1/returns').set(auth(supportToken))).status).toBe(200);
  });

  it('blocks the read-only demo role from creating one', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(demoToken))
      .send({ orderId, reason: 'test', items: [{ orderItemId, quantity: 1 }] });

    expect(res.status).toBe(403);
  });
});

describe('creating a return', () => {
  it('refuses an order that cannot legally move to RETURNED', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'changed mind', items: [{ orderItemId, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/cannot have a return requested/i);
  });

  it('refuses an item that does not belong to the order', async () => {
    const { orderId } = await makeOrder(OrderStatus.DELIVERED);
    const other = await makeOrder(OrderStatus.DELIVERED);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'wrong item', items: [{ orderItemId: other.orderItemId, quantity: 1 }] });

    expect(res.status).toBe(400);
  });

  it('refuses a quantity greater than what was ordered', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'too many', items: [{ orderItemId, quantity: 5 }] });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details?.available).toBe(4);
  });

  it('creates a REQUESTED return with a real RMA number', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'damaged on arrival', items: [{ orderItemId, quantity: 2 }] });

    expect(res.status).toBe(201);
    const body = res.body as ReturnBody;
    expect(body.data.return.status).toBe('REQUESTED');
    expect(body.data.return.rmaNumber).toMatch(/^RMA-[A-Z0-9]{8}$/);
    // Optional, and never sent here — must not silently default to a value.
    expect(body.data.return.category).toBeNull();
  });

  it('accepts an optional category alongside the free-text reason', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({
        orderId,
        reason: 'damaged on arrival',
        category: 'DAMAGED',
        items: [{ orderItemId, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect((res.body as ReturnBody).data.return.category).toBe('DAMAGED');
  });

  it('rejects a category outside the declared enum', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({
        orderId,
        reason: 'x',
        category: 'CHANGED_MY_MIND',
        items: [{ orderItemId, quantity: 1 }],
      });

    expect(res.status).toBe(400);
  });

  it('a second request is capped by what the first one left', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);

    const first = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'first batch', items: [{ orderItemId, quantity: 3 }] });
    expect(first.status).toBe(201);

    // Only 1 remains — asking for 2 must fail with the real remainder.
    const second = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'second batch', items: [{ orderItemId, quantity: 2 }] });

    expect(second.status).toBe(400);
    expect((second.body as ErrorBody).error.details?.available).toBe(1);
  });

  it('a REJECTED return frees its quantity back up', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);

    const first = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'first', items: [{ orderItemId, quantity: 4 }] });
    const firstId = (first.body as ReturnBody).data.return.id;

    await request(app)
      .post(`/api/v1/returns/${firstId}/reject`)
      .set(auth(ownerToken))
      .send({ rejectionReason: 'Duplicate request' });

    // All 4 should be requestable again now that the first was rejected.
    const second = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'second', items: [{ orderItemId, quantity: 4 }] });

    expect(second.status).toBe(201);
  });
});

describe('approving a return', () => {
  it('requires a real resolution, not NONE', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'NONE', restock: false });

    expect(res.status).toBe(400);
  });

  it('requires a refund amount when the resolution is REFUND', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', restock: false });

    expect(res.status).toBe(400);
  });

  it('caps the refund at the value of the returned items', async () => {
    // 2 units at 25.00 = 50.00 is the ceiling.
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 2 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', refundAmount: '999.00', restock: false });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details?.max).toBe('50.00');
  });

  it('approves, moves the order to RETURNED, and records the resolution', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'wrong size', items: [{ orderItemId, quantity: 2 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', refundAmount: '50.00', restock: false });

    expect(res.status).toBe(200);
    const body = res.body as ReturnBody;
    expect(body.data.return.status).toBe('APPROVED');
    expect(body.data.return.resolution).toBe('REFUND');
    expect(body.data.return.refundAmount).toBe('50.00');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe(OrderStatus.RETURNED);

    const history = await prisma.orderStatusHistory.findFirst({
      where: { orderId, toStatus: OrderStatus.RETURNED },
    });
    expect(history).not.toBeNull();
    expect(history?.note).toContain(id);
  });

  it('restocking writes a StockMovement and increments product.stock', async () => {
    const { orderId, orderItemId, productId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const before = await prisma.product.findUnique({ where: { id: productId } });

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'damaged', items: [{ orderItemId, quantity: 3 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'STORE_CREDIT', restock: true });

    expect(res.status).toBe(200);
    expect((res.body as ReturnBody).data.return.restocked).toBe(true);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId, reason: 'RETURNED', note: { contains: id } },
    });
    expect(movement?.delta).toBe(3);

    const after = await prisma.product.findUnique({ where: { id: productId } });
    expect(after?.stock).toBe((before?.stock ?? 0) + 3);
  });

  it('cannot be approved twice', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REPLACEMENT', restock: false });

    const second = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REPLACEMENT', restock: false });

    expect(second.status).toBe(400);
  });

  it('writes an audit entry', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REPLACEMENT', restock: false });

    const entry = await waitFor(() =>
      prisma.auditLog.findFirst({
        where: { entity: 'return', entityId: id, action: 'return.approved' },
      }),
    );
    expect(entry).not.toBeNull();
  });
});

describe('rejecting a return', () => {
  it('rejects a REQUESTED return without touching the order', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/reject`)
      .set(auth(ownerToken))
      .send({ rejectionReason: 'Outside the return window' });

    expect(res.status).toBe(200);
    expect((res.body as ReturnBody).data.return.status).toBe('REJECTED');
    expect((res.body as ReturnBody).data.return.rejectionReason).toBe(
      'Outside the return window',
    );

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe(OrderStatus.DELIVERED);
  });

  it('requires a rejection reason', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const missing = await request(app)
      .post(`/api/v1/returns/${id}/reject`)
      .set(auth(ownerToken))
      .send({});
    expect(missing.status).toBe(400);

    const blank = await request(app)
      .post(`/api/v1/returns/${id}/reject`)
      .set(auth(ownerToken))
      .send({ rejectionReason: '   ' });
    expect(blank.status).toBe(400);
  });

  it('cannot be rejected twice', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    await request(app)
      .post(`/api/v1/returns/${id}/reject`)
      .set(auth(ownerToken))
      .send({ rejectionReason: 'First rejection' });
    const second = await request(app)
      .post(`/api/v1/returns/${id}/reject`)
      .set(auth(ownerToken))
      .send({ rejectionReason: 'Second attempt' });

    expect(second.status).toBe(400);
  });
});

describe('the engine does not serve returns', () => {
  it('404s /r/returns', async () => {
    expect((await request(app).get('/api/v1/r/returns').set(auth(ownerToken))).status).toBe(404);
  });
});

describe('requesting a return notifies staff', () => {
  function saveSetting(body: Record<string, unknown>) {
    return request(app).patch('/api/v1/settings').set(auth(ownerToken)).send(body);
  }

  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: { type: 'return.requested', body: { contains: RUN } },
    });
    await prisma.setting.deleteMany({ where: { key: 'notifications.returnRequestAlerts' } });
  });

  it('creates a notification carrying the reason', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const reason = `${RUN} arrived broken`;

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason, items: [{ orderItemId, quantity: 1 }] });
    expect(res.status).toBe(201);

    const notification = await waitFor(() =>
      prisma.notification.findFirst({
        where: { type: 'return.requested', body: reason },
      }),
    );
    expect(notification?.title).toContain((res.body as ReturnBody).data.return.rmaNumber);
  });

  it('does not notify when notifications.returnRequestAlerts is off', async () => {
    await saveSetting({ 'notifications.returnRequestAlerts': false });

    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const reason = `${RUN} disabled alerts`;

    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason, items: [{ orderItemId, quantity: 1 }] });
    expect(res.status).toBe(201);

    await waitForNoWrite();

    expect(
      await prisma.notification.count({ where: { type: 'return.requested', body: reason } }),
    ).toBe(0);
  });
});
