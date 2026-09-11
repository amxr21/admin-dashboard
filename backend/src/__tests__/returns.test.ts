import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken, verifyManagerOverride } from '../services/auth.service.js';
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
      restockingFeePercent: string | null;
      restocked: boolean;
      rejectionReason: string | null;
      order: { id: string; status?: OrderStatus };
      items: { orderItemId: string; quantity: number }[];
      withinWindow: boolean;
      daysSincePurchase: number;
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
/** So a restock resolves ONE explicit branch rather than falling through to
 *  `defaultBranchId()` — this suite's shared test database carries the
 *  seeded demo businesses, which now REFUSES to guess once more than one
 *  business exists (O9.18). */
let branchId = '';
const businessIds: string[] = [];
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
  return { token: signToken(user), id: user.id, email: user.email };
}

async function makeProduct(stock = 10) {
  const product = await prisma.product.create({
    data: { name: `${RUN} widget ${productIds.length}`, price: new Prisma.Decimal('25.00'), stock },
  });
  productIds.push(product.id);
  return product.id;
}

/** An order with one line item of the given quantity, at the given status. */
async function makeOrder(status: OrderStatus, quantity = 4, placedAt?: Date) {
  const productId = await makeProduct();

  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      status,
      total: new Prisma.Decimal('25.00').mul(quantity),
      customerId,
      branchId,
      // Omitted uses the column default (now()) — only the return-window
      // tests (B4.11) need to backdate this.
      ...(placedAt ? { placedAt } : {}),
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

  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessIds.push(business.id);
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `${RUN} branch` },
  });
  branchId = branch.id;
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
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
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

  it('requires a refund reason when the resolution is REFUND (URG-009)', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', refundAmount: '10.00', restock: false });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/why this refund/i);
  });

  it('requires a note when the refund reason is OTHER (URG-009)', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '10.00',
        refundReason: 'OTHER',
        restock: false,
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/describe the refund reason/i);
  });

  it('refuses a refund reason on a non-refund resolution (URG-009)', async () => {
    // A refund reason on a REPLACEMENT would be a stored fact that never
    // happened.
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REPLACEMENT', refundReason: 'DAMAGED', restock: false });

    expect(res.status).toBe(400);
  });

  it('records the refund reason and its note (URG-009)', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '10.00',
        refundReason: 'OTHER',
        refundReasonNote: 'Store policy goodwill',
        restock: false,
      });

    expect(res.status).toBe(200);

    const row = await prisma.return.findUnique({
      where: { id },
      select: { refundReason: true, refundReasonNote: true },
    });
    expect(row?.refundReason).toBe('OTHER');
    expect(row?.refundReasonNote).toBe('Store policy goodwill');
  });

  it('stores no note for a catalogued refund reason (URG-009)', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '10.00',
        refundReason: 'DAMAGED',
        restock: false,
      });

    expect(res.status).toBe(200);

    const row = await prisma.return.findUnique({
      where: { id },
      select: { refundReason: true, refundReasonNote: true },
    });
    expect(row?.refundReason).toBe('DAMAGED');
    // NULL, never an empty string — "no note" is the real state.
    expect(row?.refundReasonNote).toBeNull();
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

describe('return window and restocking fee (B4.11)', () => {
  afterEach(async () => {
    await prisma.setting.deleteMany({
      where: { key: { in: ['returns.windowDays', 'returns.restockingFeePercent'] } },
    });
  });

  it('a return within the default window reports withinWindow: true', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });

    const body = created.body as ReturnBody;
    expect(body.data.return.withinWindow).toBe(true);
  });

  it('a return past the window still processes — a warning, not a gate', async () => {
    await prisma.setting.upsert({
      where: { key: 'returns.windowDays' },
      create: { key: 'returns.windowDays', value: 7 },
      update: { value: 7 },
    });

    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4, longAgo);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });

    expect(created.status).toBe(201);
    const body = created.body as ReturnBody;
    expect(body.data.return.withinWindow).toBe(false);
    expect(body.data.return.daysSincePurchase).toBeGreaterThanOrEqual(30);

    // Still approvable — nothing about being late refuses the request.
    const id = body.data.return.id;
    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REPLACEMENT', restock: false });

    expect(res.status).toBe(200);
  });

  it('windowDays: 0 means no window — always within it, however old', async () => {
    await prisma.setting.upsert({
      where: { key: 'returns.windowDays' },
      create: { key: 'returns.windowDays', value: 0 },
      update: { value: 0 },
    });

    const yearsAgo = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000);
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4, yearsAgo);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });

    expect((created.body as ReturnBody).data.return.withinWindow).toBe(true);
  });

  it('the store default restocking fee reduces the refund cap', async () => {
    await prisma.setting.upsert({
      where: { key: 'returns.restockingFeePercent' },
      create: { key: 'returns.restockingFeePercent', value: 20 },
      update: { value: 20 },
    });

    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 2 }] });
    const id = (created.body as ReturnBody).data.return.id;

    // 2 items at 25.00 = 50.00, minus a 20% fee = 40.00 cap.
    const overCap = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', refundAmount: '45.00', restock: false });
    expect(overCap.status).toBe(400);
    expect((overCap.body as ErrorBody).error.details?.max).toBe('40.00');

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', refundAmount: '40.00', restock: false });
    expect(res.status).toBe(200);
    expect((res.body as ReturnBody).data.return.restockingFeePercent).toBe('20.00');
  });

  it('the approving person can waive the store default fee for one return', async () => {
    await prisma.setting.upsert({
      where: { key: 'returns.restockingFeePercent' },
      create: { key: 'returns.restockingFeePercent', value: 20 },
      update: { value: 20 },
    });

    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'defective', items: [{ orderItemId, quantity: 2 }] });
    const id = (created.body as ReturnBody).data.return.id;

    // Waived to 0% for this one return — the full 50.00 is now the cap.
    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '50.00',
        restockingFeePercent: 0,
        restock: false,
      });

    expect(res.status).toBe(200);
    expect((res.body as ReturnBody).data.return.restockingFeePercent).toBe('0.00');
  });

  it('refuses an out-of-range restocking fee', async () => {
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED, 4);
    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: 'x', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '10.00',
        restockingFeePercent: 150,
        restock: false,
      });

    expect(res.status).toBe(400);
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

describe('deciding a return line by line (B4.7, B4.8)', () => {
  /**
   * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
   * Approving a return used to be all-or-nothing. A shop that gets three
   * items back and finds one unsellable had to accept all three or refuse
   * the lot — so the money and the stock were both wrong, in opposite
   * directions.
   *
   * The rules that matter here move real money and real stock:
   *  1. The refund is capped to what was ACCEPTED, not what was asked.
   *     Refunding the full request after refusing a line pays for goods the
   *     shop never took back.
   *  2. Only accepted quantities are restocked. A refused line goes back to
   *     the customer and was never on the shelf.
   *  3. A refused line needs a REASON — "some of your return was refused"
   *     with no explanation is the complaint that follows.
   */

  /** An order with TWO distinct lines, for the partial cases. */
  async function makeTwoLineOrder() {
    const productA = await makeProduct();
    const productB = await makeProduct();

    const order = await prisma.order.create({
      data: {
        orderNumber: `${RUN}-two-${orderIds.length}`,
        status: OrderStatus.DELIVERED,
        total: new Prisma.Decimal('125.00'),
        customerId,
        branchId,
        items: {
          create: [
            { productId: productA, quantity: 3, price: new Prisma.Decimal('25.00') },
            { productId: productB, quantity: 2, price: new Prisma.Decimal('25.00') },
          ],
        },
      },
      include: { items: true },
    });
    orderIds.push(order.id);

    return {
      orderId: order.id,
      lineA: order.items[0]!,
      lineB: order.items[1]!,
      productA,
      productB,
    };
  }

  async function requestReturn(orderId: string, items: { orderItemId: string; quantity: number }[]) {
    const res = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId, reason: `${RUN} partial`, items });

    const created = res.body as { data: { return: { id: string } } };

    const rows = await prisma.returnItem.findMany({
      where: { returnId: created.data.return.id },
      select: { id: true, orderItemId: true, quantity: true },
    });

    return { returnId: created.data.return.id, rows };
  }

  it('accepts everything when no decisions are given', async () => {
    // The behaviour approving a return has always had, so an older client
    // keeps working unchanged.
    const { orderId, lineA } = await makeTwoLineOrder();
    const { returnId } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 2 },
    ]);

    const res = await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'REFUND', refundAmount: '50.00', restock: false });

    expect(res.status).toBe(200);

    const items = await prisma.returnItem.findMany({ where: { returnId } });
    expect(items[0]?.status).toBe('ACCEPTED');
    expect(items[0]?.acceptedQuantity).toBe(2);
  });

  it('caps the refund to what was ACCEPTED, not what was asked', async () => {
    // The money rule. Two lines of 25.00 each requested; one refused, so the
    // ceiling is 50.00 rather than 125.00.
    const { orderId, lineA, lineB } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 2 },
      { orderItemId: lineB.id, quantity: 2 },
    ]);

    const rowA = rows.find((row) => row.orderItemId === lineA.id)!;
    const rowB = rows.find((row) => row.orderItemId === lineB.id)!;

    const res = await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        // 100.00 was the ceiling before the refusal; now only A's 2 count.
        refundAmount: '100.00',
        restock: false,
        items: [
          { returnItemId: rowA.id, accepted: true },
          { returnItemId: rowB.id, accepted: false, rejectionReason: 'Used, not sellable' },
        ],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/50\.00/);
  });

  it('restocks only the accepted quantity, at the right branch', async () => {
    // The stock rule, plus the F8.2 invariant: the movement, `BranchStock`
    // and `Product.stock` all have to agree.
    const { orderId, lineA, productA } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 3 },
    ]);

    const before = await prisma.product.findUnique({ where: { id: productA } });

    await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: true,
        // Three came back; only ONE was sellable.
        items: [{ returnItemId: rows[0]!.id, accepted: true, acceptedQuantity: 1 }],
      })
      .expect(200);

    const after = await prisma.product.findUnique({ where: { id: productA } });
    expect(after!.stock).toBe(before!.stock + 1);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: productA, reason: 'RETURNED' },
      select: { delta: true, branchId: true },
    });

    expect(movement?.delta).toBe(1);
    // Recorded against a branch — without it the movement log and
    // BranchStock stop agreeing with Product.stock.
    expect(movement?.branchId).not.toBeNull();
  });

  it('does not restock a refused line', async () => {
    // It went back to the customer; it was never on the shelf.
    const { orderId, lineA, lineB, productB } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 1 },
      { orderItemId: lineB.id, quantity: 1 },
    ]);

    const rowA = rows.find((row) => row.orderItemId === lineA.id)!;
    const rowB = rows.find((row) => row.orderItemId === lineB.id)!;
    const before = await prisma.product.findUnique({ where: { id: productB } });

    await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: true,
        items: [
          { returnItemId: rowA.id, accepted: true },
          { returnItemId: rowB.id, accepted: false, rejectionReason: 'Missing packaging' },
        ],
      })
      .expect(200);

    const after = await prisma.product.findUnique({ where: { id: productB } });
    expect(after!.stock).toBe(before!.stock);

    // And NO movement row at all for the refused product. Checking the stock
    // total alone is not enough: a rejected line carries quantity 0, so a
    // restock that failed to skip it would add zero and look identical here
    // while writing a phantom RETURNED movement into the log.
    const phantom = await prisma.stockMovement.findFirst({
      where: { productId: productB, reason: 'RETURNED' },
    });
    expect(phantom).toBeNull();
  });

  it('requires a reason for every refused line', async () => {
    const { orderId, lineA } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 1 },
    ]);

    const res = await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '0',
        restock: false,
        items: [{ returnItemId: rows[0]!.id, accepted: false }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/reason/i);
  });

  it('refuses accepting MORE than was returned', async () => {
    // Would refund and restock goods the customer never brought back.
    const { orderId, lineA } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 2 },
    ]);

    const res = await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: false,
        items: [{ returnItemId: rows[0]!.id, accepted: true, acceptedQuantity: 5 }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/only 2/i);
  });

  it('refuses an approval where NOTHING is accepted', async () => {
    // That is a rejection of the whole return, and must not move the order to
    // RETURNED as though goods had come back.
    const { orderId, lineA } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 1 },
    ]);

    const res = await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '0',
        restock: false,
        items: [{ returnItemId: rows[0]!.id, accepted: false, rejectionReason: 'All damaged' }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/reject the return/i);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('DELIVERED');
  });

  it('refuses a decision naming a line from another return', async () => {
    // The operator was looking at a different return; silently ignoring it
    // would approve something they did not intend.
    const { orderId, lineA } = await makeTwoLineOrder();
    const { returnId } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 1 },
    ]);

    const res = await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: false,
        items: [{ returnItemId: 'not-a-line-on-this-return', accepted: true }],
      });

    expect(res.status).toBe(400);
  });

  it('records the per-line outcome so a partial approval is legible', async () => {
    // Otherwise the only trace is a refund total, and "which item did we
    // refuse" has no answer.
    const { orderId, lineA, lineB } = await makeTwoLineOrder();
    const { returnId, rows } = await requestReturn(orderId, [
      { orderItemId: lineA.id, quantity: 2 },
      { orderItemId: lineB.id, quantity: 1 },
    ]);

    const rowA = rows.find((row) => row.orderItemId === lineA.id)!;
    const rowB = rows.find((row) => row.orderItemId === lineB.id)!;

    await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: false,
        items: [
          { returnItemId: rowA.id, accepted: true, acceptedQuantity: 1 },
          { returnItemId: rowB.id, accepted: false, rejectionReason: 'Opened' },
        ],
      })
      .expect(200);

    const saved = await prisma.returnItem.findMany({
      where: { returnId },
      select: { id: true, status: true, acceptedQuantity: true, rejectionReason: true },
    });

    const savedA = saved.find((row) => row.id === rowA.id);
    const savedB = saved.find((row) => row.id === rowB.id);

    expect(savedA?.status).toBe('ACCEPTED');
    expect(savedA?.acceptedQuantity).toBe(1);
    expect(savedB?.status).toBe('REJECTED');
    expect(savedB?.rejectionReason).toBe('Opened');
  });
});

describe('a cashier cannot approve or reject alone (O9.7)', () => {
  it('refuses a cashier approving with no manager override', async () => {
    const cashier = await makeUser(StaffRole.CASHIER, 'return-cashier-1');
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier.token))
      .send({ orderId, reason: 'damaged', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(cashier.token))
      .send({ resolution: 'REFUND', refundAmount: '25.00', restock: false });

    expect(res.status).toBe(403);

    // Refused before anything moved.
    const row = await prisma.return.findUnique({ where: { id } });
    expect(row?.status).toBe('REQUESTED');
  });

  it('refuses a cashier rejecting with no manager override', async () => {
    const cashier = await makeUser(StaffRole.CASHIER, 'return-cashier-2');
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier.token))
      .send({ orderId, reason: 'damaged', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/reject`)
      .set(auth(cashier.token))
      .send({ rejectionReason: 'Used' });

    expect(res.status).toBe(403);
  });

  it('approves once a real manager override token verifies', async () => {
    const cashier = await makeUser(StaffRole.CASHIER, 'return-cashier-3');
    const manager = await makeUser(StaffRole.MANAGER, 'return-manager-1');
    const approval = await verifyManagerOverride(
      manager.email,
      'correct-horse-battery-staple',
    );

    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier.token))
      .send({ orderId, reason: 'damaged', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(cashier.token))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: false,
        overrideToken: approval.overrideToken,
      });

    expect(res.status).toBe(200);
  });

  it('rejects a forged override token', async () => {
    const cashier = await makeUser(StaffRole.CASHIER, 'return-cashier-4');
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(cashier.token))
      .send({ orderId, reason: 'damaged', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(cashier.token))
      .send({
        resolution: 'REFUND',
        refundAmount: '25.00',
        restock: false,
        overrideToken: 'not-a-real-token',
      });

    expect(res.status).toBe(403);
  });

  it('lets a MANAGER approve directly, with no override token at all', async () => {
    // Already manager-or-above needs no second manager to approve THEM.
    const manager = await makeUser(StaffRole.MANAGER, 'return-manager-2');
    const { orderId, orderItemId } = await makeOrder(OrderStatus.DELIVERED);

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(manager.token))
      .send({ orderId, reason: 'damaged', items: [{ orderItemId, quantity: 1 }] });
    const id = (created.body as ReturnBody).data.return.id;

    const res = await request(app)
      .post(`/api/v1/returns/${id}/approve`)
      .set(auth(manager.token))
      .send({ resolution: 'REFUND', refundAmount: '25.00', restock: false });

    expect(res.status).toBe(200);
  });
});
