import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderFulfillment, OrderStatus, Prisma, ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { createApiKey } from '../services/api-key.service.js';
import { canTransition, nextStatuses } from '../config/orders.config.js';
import { phonesMatch } from '../lib/phone.js';

/**
 * Pickup as a real path (FX-14).
 *
 * A storefront order is either delivered or collected, and the two never
 * share a middle: a pickup is not "shipped", and a delivery never sits on the
 * counter waiting. The order records which it is, with the contact and
 * address the customer gave — as fields, not as free text in a staff note.
 */

const app = createApp();

const RUN = `fulfil-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PHONE = '+971 50 123 4567';

const orderIds: string[] = [];
const courierIds: string[] = [];
let businessId = '';
let branchId = '';
let ownerId = '';
let ownerToken = '';
let storefrontKey = '';
let productId = '';

function staff() {
  return { Authorization: `Bearer ${ownerToken}`, 'X-Branch-Id': branchId } as const;
}

function checkout(fulfillment: 'Pickup' | 'Delivery', contact: Record<string, string> = {}) {
  return request(app)
    .post('/api/v1/public/orders')
    .set('X-API-Key', storefrontKey)
    .set('Idempotency-Key', randomUUID())
    .send({
      branchId,
      items: [{ productId, quantity: 1 }],
      contact: { name: 'Mariam', phone: PHONE, ...contact },
      paymentMethod: 'cash',
      fulfillment,
    });
}

async function placed(fulfillment: 'Pickup' | 'Delivery', contact: Record<string, string> = {}) {
  const res = await checkout(fulfillment, contact);
  expect(res.status).toBe(201);
  const { orderNumber } = (res.body as { data: { orderNumber: string } }).data;
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
  orderIds.push(order.id);
  return order;
}

/** An order straight in the table, for the paths checkout cannot create. */
async function stored(status: OrderStatus, fulfillment: OrderFulfillment | null) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      status,
      fulfillment,
      branchId,
      total: new Prisma.Decimal('20.00'),
      items: { create: [{ productId, quantity: 1, price: new Prisma.Decimal('20.00') }] },
    },
  });
  orderIds.push(order.id);
  return order;
}

const move = (id: string, to: OrderStatus) =>
  request(app)
    .patch(`/api/v1/orders/${id}/status`)
    .set(staff())
    .send(to === OrderStatus.CANCELED ? { to, cancellationReason: 'CUSTOMER_REQUEST' } : { to });

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: `${RUN} owner`,
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  ownerId = owner.id;
  ownerToken = signToken(owner);
  storefrontKey = (await createApiKey(owner.id, 'Fulfilment test', 'Exercise checkout', 'Test suite')).key;

  const business = await prisma.business.create({
    data: { name: `${RUN} business`, branches: { create: { name: `${RUN} branch`, isDefault: true } } },
    include: { branches: true },
  });
  businessId = business.id;
  branchId = business.branches[0]!.id;
  await prisma.userBranch.create({ data: { userId: owner.id, branchId, role: StaffRole.OWNER } });

  const product = await prisma.product.create({
    data: { name: `${RUN} cookie box`, price: new Prisma.Decimal('20.00'), stock: 100, status: ProductStatus.ACTIVE },
  });
  productId = product.id;
  await prisma.branchStock.create({ data: { productId, branchId, quantity: 100 } });
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.deliveryStaff.deleteMany({ where: { id: { in: courierIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.idempotencyRecord.deleteMany({ where: { scope: 'storefront.checkout', actorId: ownerId } });
  await prisma.userBranch.deleteMany({ where: { userId: ownerId } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe('checkout records how and to whom, as fields', () => {
  it('keeps a delivery order’s address, contact and note on the order itself', async () => {
    const order = await placed('Delivery', {
      email: 'mariam@example.test',
      address: 'Villa 12, Street 4',
      city: 'Al Ain',
      note: 'Ring twice',
    });

    expect(order).toMatchObject({
      fulfillment: OrderFulfillment.DELIVERY,
      contactName: 'Mariam',
      contactPhone: PHONE,
      contactEmail: 'mariam@example.test',
      deliveryAddress: 'Villa 12, Street 4',
      deliveryCity: 'Al Ain',
      customerNote: 'Ring twice',
    });
    // No longer smuggled into the staff notes thread as free text.
    expect(await prisma.orderNote.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('drops an address typed before the shopper switched to pickup', async () => {
    const order = await placed('Pickup', { address: 'Villa 12', city: 'Al Ain' });

    expect(order).toMatchObject({ fulfillment: OrderFulfillment.PICKUP, deliveryAddress: null, deliveryCity: null });
  });

  it('shows staff the details on the order', async () => {
    const order = await placed('Delivery', { address: 'Villa 12', city: 'Al Ain' });

    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(staff());

    expect(res.status).toBe(200);
    expect((res.body as { data: { order: unknown } }).data.order).toMatchObject({
      fulfillment: 'DELIVERY',
      contact: { name: 'Mariam', phone: PHONE, email: null },
      delivery: { address: 'Villa 12', city: 'Al Ain' },
    });
  });

  it('finds a guest order by the name it was placed under', async () => {
    const order = await placed('Pickup', { name: `${RUN} Noura` });

    const res = await request(app).get('/api/v1/orders').query({ search: `${RUN} Noura` }).set(staff());

    const rows = (res.body as { data: { orders: { id: string; contactName: string; fulfillment: string }[] } }).data.orders;
    expect(rows).toEqual([expect.objectContaining({ id: order.id, contactName: `${RUN} Noura`, fulfillment: 'PICKUP' })]);
  });
});

describe('a pickup order is readied and collected, never shipped', () => {
  it('walks CONFIRMED → READY_FOR_PICKUP → COLLECTED', async () => {
    const order = await placed('Pickup');

    for (const to of [OrderStatus.CONFIRMED, OrderStatus.READY_FOR_PICKUP, OrderStatus.COLLECTED]) {
      expect((await move(order.id, to)).status).toBe(200);
    }
    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(staff());
    expect((res.body as { data: { order: { nextStatuses: string[] } } }).data.order.nextStatuses).toEqual([
      OrderStatus.RETURNED,
    ]);
  });

  it('is only ever offered its own path', async () => {
    const order = await stored(OrderStatus.CONFIRMED, OrderFulfillment.PICKUP);

    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(staff());

    expect((res.body as { data: { order: { nextStatuses: string[] } } }).data.order.nextStatuses).toEqual([
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.CANCELED,
      OrderStatus.RETURNED,
    ]);
  });

  it('refuses SHIPPED, and says why', async () => {
    const order = await stored(OrderStatus.CONFIRMED, OrderFulfillment.PICKUP);

    const res = await move(order.id, OrderStatus.SHIPPED);

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toBe('A pickup order cannot move to SHIPPED');
  });

  it('can still be cancelled while it waits — and the goods go back on the shelf', async () => {
    const order = await stored(OrderStatus.READY_FOR_PICKUP, OrderFulfillment.PICKUP);
    const before = await prisma.branchStock.findUniqueOrThrow({ where: { productId_branchId: { productId, branchId } } });

    expect((await move(order.id, OrderStatus.CANCELED)).status).toBe(200);

    const after = await prisma.branchStock.findUniqueOrThrow({ where: { productId_branchId: { productId, branchId } } });
    expect(after.quantity).toBe(before.quantity + 1);
  });

  it('gets no courier', async () => {
    const order = await stored(OrderStatus.CONFIRMED, OrderFulfillment.PICKUP);
    const courier = await prisma.deliveryStaff.create({
      data: { name: `${RUN} courier`, branches: { create: { branchId } } },
    });
    courierIds.push(courier.id);

    const res = await request(app)
      .post('/api/v1/assignments')
      .set(staff())
      .send({ orderId: order.id, driverId: courier.id });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/collected from the branch/);
  });
});

describe('a delivery order never waits on the counter', () => {
  it('refuses READY_FOR_PICKUP', async () => {
    const order = await stored(OrderStatus.CONFIRMED, OrderFulfillment.DELIVERY);

    expect((await move(order.id, OrderStatus.READY_FOR_PICKUP)).status).toBe(400);
  });

  it('hands its courier the address and contact the customer gave', async () => {
    const order = await placed('Delivery', { name: 'Hessa', address: 'Villa 7', city: 'Al Ain' });
    await move(order.id, OrderStatus.CONFIRMED);
    const courier = await prisma.deliveryStaff.create({
      data: { name: `${RUN} courier 2`, branches: { create: { branchId } } },
    });
    courierIds.push(courier.id);

    const res = await request(app)
      .post('/api/v1/assignments')
      .set(staff())
      .send({ orderId: order.id, driverId: courier.id });

    expect(res.status).toBe(201);
    const assignment = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(assignment).toMatchObject({ customerName: 'Hessa', customerPhone: PHONE, address: 'Villa 7', city: 'Al Ain' });
  });
});

describe('orders from before fulfillment was recorded', () => {
  it('may take either path, so nothing in flight is stranded', () => {
    expect(nextStatuses(OrderStatus.CONFIRMED, null)).toEqual(
      expect.arrayContaining([OrderStatus.SHIPPED, OrderStatus.READY_FOR_PICKUP]),
    );
    expect(canTransition(OrderStatus.READY_FOR_PICKUP, OrderStatus.COLLECTED)).toBe(true);
  });

  it('counts only the orders each move suits in a bulk preview', async () => {
    const pickup = await stored(OrderStatus.CONFIRMED, OrderFulfillment.PICKUP);
    const delivery = await stored(OrderStatus.CONFIRMED, OrderFulfillment.DELIVERY);
    const legacy = await stored(OrderStatus.CONFIRMED, null);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(staff())
      .send({ ids: [pickup.id, delivery.id, legacy.id], to: OrderStatus.SHIPPED });

    expect((res.body as { data: { eligibleCount: number } }).data.eligibleCount).toBe(2);
  });
});

describe('tracking an order by its phone', () => {
  const track = (orderNumber: string, phone: string) =>
    request(app).get('/api/v1/public/orders/track').set('X-API-Key', storefrontKey).query({ orderNumber, phone });

  it('matches the number however it is typed, and says how the order is fulfilled', async () => {
    const order = await placed('Pickup');

    for (const typed of ['0501234567', '+971501234567', '00971 50 123 4567']) {
      const res = await track(order.orderNumber, typed);
      expect(res.status).toBe(200);
      expect((res.body as { data: { fulfillment: string } }).data.fulfillment).toBe('PICKUP');
    }
  });

  it('refuses a fragment of a number', async () => {
    const order = await placed('Pickup');

    // The last digits of the real number, but too few to be one — once enough
    // to match, since the note's other digits counted too.
    for (const typed of ['4567', '234567', '123 4567 8']) {
      expect((await track(order.orderNumber, typed)).status).toBe(404);
    }
  });

  it('reads an older order’s contact line — and only that line', async () => {
    const order = await stored(OrderStatus.PENDING, null);
    await prisma.orderNote.create({
      data: {
        orderId: order.id,
        authorId: null,
        body: 'Contact: Mariam (+971 50 765 4321)\nFulfillment: Delivery\nAddress: Building 9876543, Flat 21',
      },
    });

    expect((await track(order.orderNumber, '050 765 4321')).status).toBe(200);
    // Digits from the address line are not a phone number.
    expect((await track(order.orderNumber, '9876543')).status).toBe(404);
  });
});

describe('phonesMatch', () => {
  it.each([
    ['050 123 4567', '+971 50 123 4567', true],
    ['00971501234567', '0501234567', true],
    ['501234567', '+971501234567', true],
    ['0501234567', '0501234568', false],
    ['0', '0501234567', false],
    ['123456', '0501234567', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(phonesMatch(a, b)).toBe(expected);
  });
});
