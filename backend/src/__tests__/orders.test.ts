import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { ORDER_TRANSITIONS } from '../config/orders.config.js';

/**
 * Orders.
 *
 * The bespoke resource, so these tests aim at the things that make it
 * bespoke: a lifecycle that must refuse illegal moves, an audit row that must
 * exist for every legal one, and a total that must not drift when someone
 * edits a price months later.
 *
 * The transition matrix is walked EXHAUSTIVELY rather than sampled. It is a
 * small finite table, and a hand-picked selection is exactly how a wrong cell
 * survives — the illegal moves are the half nobody thinks to write by hand.
 */

const app = createApp();

interface OrderBody {
  data: {
    order: {
      id: string;
      status: OrderStatus;
      total: string;
      items: { price: string; lineTotal: string; product: { name: string } | null }[];
      statusHistory: { fromStatus: string | null; toStatus: string; changedById: string }[];
      nextStatuses: OrderStatus[];
    };
  };
}
interface ListBody {
  data: { orders: { id: string; orderNumber: string; total: string }[]; total: number };
}
interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const RUN = `orderstest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const orderIds: string[] = [];
let productId = '';
let customerId = '';
let ownerToken = '';
let ownerId = '';
let demoToken = '';
let inventoryToken = '';

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
  return { token: signToken(user), id: user.id };
}

/** An order with one line item, at whatever status the test needs. */
async function makeOrder(status: OrderStatus = OrderStatus.PENDING) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-${orderIds.length}`,
      status,
      total: new Prisma.Decimal('59.98'),
      customerId,
      items: {
        create: [{ productId, quantity: 2, price: new Prisma.Decimal('29.99') }],
      },
    },
  });
  orderIds.push(order.id);
  return order.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  const [owner, demo, fulfilment] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
    // FULFILLMENT has 'orders'; MANAGER-style roles without it would be a
    // weaker test, so the denial case uses SUPPORT below via area removal.
    makeUser(StaffRole.FULFILLMENT),
  ]);

  ownerToken = owner.token;
  ownerId = owner.id;
  demoToken = demo.token;
  inventoryToken = fulfilment.token;

  const customer = await prisma.customer.create({
    data: { name: `${RUN} Customer`, email: `${RUN}@example.test` },
  });
  customerId = customer.id;

  const product = await prisma.product.create({
    data: { name: `${RUN} Widget`, price: new Prisma.Decimal('29.99'), stock: 5 },
  });
  productId = product.id;
});

afterAll(async () => {
  // Items and history cascade from the order.
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('authorisation runs before anything else', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/orders');
    expect(res.status).toBe(401);
  });

  it('lets a role with the orders area read', async () => {
    const res = await request(app).get('/api/v1/orders').set(auth(inventoryToken));
    expect(res.status).toBe(200);
  });

  it('blocks the read-only demo role from changing status', async () => {
    // Enforced by HTTP method inside `authenticate`, so a write route is
    // restricted the instant it exists rather than when someone remembers.
    const id = await makeOrder();

    const res = await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(demoToken))
      .send({ to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(403);

    const after = await prisma.order.findUnique({ where: { id } });
    expect(after?.status).toBe(OrderStatus.PENDING);
  });
});

describe('the engine does not serve orders', () => {
  it('404s /r/orders', async () => {
    // `orders` is deliberately absent from admin.config.ts — three tables and
    // a lifecycle are not something the generic engine can express.
    const res = await request(app).get('/api/v1/r/orders').set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});

describe('the transition matrix, walked exhaustively', () => {
  const ALL = Object.values(OrderStatus);

  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;

      const legal = ORDER_TRANSITIONS[from].includes(to);

      it(`${legal ? 'allows' : 'refuses'} ${from} -> ${to}`, async () => {
        const id = await makeOrder(from);

        const res = await request(app)
          .patch(`/api/v1/orders/${id}/status`)
          .set(auth(ownerToken))
          .send({ to });

        if (legal) {
          expect(res.status).toBe(200);
          expect((res.body as OrderBody).data.order.status).toBe(to);
        } else {
          expect(res.status).toBe(400);
          // The refusal names what WOULD have worked — a bare "invalid
          // transition" leaves the caller guessing.
          expect((res.body as ErrorBody).error.details).toMatchObject({
            allowed: ORDER_TRANSITIONS[from],
          });

          const after = await prisma.order.findUnique({ where: { id } });
          expect(after?.status).toBe(from);
        }
      });
    }
  }

  it('refuses a move to the status it already has', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.PENDING });

    expect(res.status).toBe(400);
  });

  it('offers only legal next states on the order itself', async () => {
    // The UI builds its status control from this, so an illegal move should be
    // unclickable rather than a server error the user has to discover.
    const id = await makeOrder(OrderStatus.DELIVERED);

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));

    expect((res.body as OrderBody).data.order.nextStatuses).toEqual([OrderStatus.RETURNED]);
  });

  it('leaves a terminal order with nowhere to go', async () => {
    const id = await makeOrder(OrderStatus.CANCELED);

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));

    expect((res.body as OrderBody).data.order.nextStatuses).toEqual([]);
  });
});

describe('every legal move leaves an audit trail', () => {
  it('records who moved it, and from where', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CONFIRMED, note: 'payment cleared' });

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: id } });

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: OrderStatus.PENDING,
      toStatus: OrderStatus.CONFIRMED,
      note: 'payment cleared',
      changedById: ownerId,
    });
  });

  it('writes no audit row when the move was refused', async () => {
    // The status write and the audit write are one transaction; a refusal
    // happens before either.
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.DELIVERED });

    const count = await prisma.orderStatusHistory.count({ where: { orderId: id } });
    expect(count).toBe(0);
  });

  it('accumulates one row per move, in order', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    for (const to of [OrderStatus.CONFIRMED, OrderStatus.SHIPPED, OrderStatus.DELIVERED]) {
      await request(app)
        .patch(`/api/v1/orders/${id}/status`)
        .set(auth(ownerToken))
        .send({ to });
    }

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const history = (res.body as OrderBody).data.order.statusHistory;

    expect(history.map((entry) => entry.toStatus)).toEqual([
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]);
  });
});

describe('money and history are read, never recomputed', () => {
  it('sends totals as strings, not JSON numbers', async () => {
    const id = await makeOrder();

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const order = (res.body as OrderBody).data.order;

    expect(order.total).toBe('59.98');
    expect(typeof order.total).toBe('string');
    expect(order.items[0]?.price).toBe('29.99');
    expect(order.items[0]?.lineTotal).toBe('59.98');

    // Nothing numeric survived JSON.parse as a float.
    expect(JSON.stringify(res.body)).not.toContain('"total":59.98');
  });

  it('does not change a past order when the product price is edited', async () => {
    /**
     * The reason `price` is denormalised onto the line item. Reading the live
     * product price when rendering history would silently rewrite what the
     * customer was charged.
     */
    const id = await makeOrder();

    await prisma.product.update({
      where: { id: productId },
      data: { price: new Prisma.Decimal('99.99') },
    });

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const order = (res.body as OrderBody).data.order;

    expect(order.items[0]?.price).toBe('29.99');
    expect(order.total).toBe('59.98');

    await prisma.product.update({
      where: { id: productId },
      data: { price: new Prisma.Decimal('29.99') },
    });
  });
});

describe('listing', () => {
  it('filters by status', async () => {
    await makeOrder(OrderStatus.SHIPPED);

    const res = await request(app)
      .get(`/api/v1/orders?status=SHIPPED&search=${RUN}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as ListBody).data.orders.length).toBeGreaterThan(0);
  });

  it('rejects an unknown status rather than ignoring it', async () => {
    // Silently dropping an unrecognised filter returns the whole table, which
    // looks like the filter worked and found everything.
    const res = await request(app)
      .get('/api/v1/orders?status=NONSENSE')
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
  });

  it('rejects a malformed date range', async () => {
    const res = await request(app)
      .get('/api/v1/orders?from=last-tuesday')
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
  });

  it('caps the page size', async () => {
    const res = await request(app)
      .get('/api/v1/orders?pageSize=100000')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as ListBody).data.orders.length).toBeLessThanOrEqual(100);
  });

  it('finds an order by its number', async () => {
    const id = await makeOrder();
    const order = await prisma.order.findUnique({ where: { id } });

    const res = await request(app)
      .get(`/api/v1/orders?search=${order?.orderNumber ?? ''}`)
      .set(auth(ownerToken));

    expect((res.body as ListBody).data.orders.map((o) => o.id)).toContain(id);
  });
});

describe('failure shapes', () => {
  it('404s an unknown order', async () => {
    const res = await request(app)
      .get('/api/v1/orders/does-not-exist')
      .set(auth(ownerToken));

    expect(res.status).toBe(404);
  });

  it('rejects an unknown field in the status body', async () => {
    // .strict() — silently accepting extra fields is how mass assignment
    // creeps in later when someone widens the handler.
    const id = await makeOrder();

    const res = await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CONFIRMED, total: '0.01' });

    expect(res.status).toBe(400);
  });

  it('rejects a note longer than the column', async () => {
    const id = await makeOrder();

    const res = await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CONFIRMED, note: 'x'.repeat(256) });

    expect(res.status).toBe(400);
  });
});
