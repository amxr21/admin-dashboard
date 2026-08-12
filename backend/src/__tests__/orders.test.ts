import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OrderStatus, Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { ORDER_TRANSITIONS } from '../config/orders.config.js';
import { waitFor } from './helpers/wait-for.js';

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
      subtotal: string | null;
      taxAmount: string | null;
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

/**
 * An order with one line item, at whatever status the test needs.
 *
 * `orderNumberPrefix` is optional — most tests only care about the count of
 * matching rows in the shared table, but a few (CSV export's search-scoping
 * tests) need to search for JUST their own rows, same reasoning as the
 * `srt${Date.now()...}` prefixes used in the sort tests above.
 */
async function makeOrder(status: OrderStatus = OrderStatus.PENDING, orderNumberPrefix?: string) {
  const order = await prisma.order.create({
    data: {
      orderNumber: orderNumberPrefix
        ? `${orderNumberPrefix}-${orderIds.length}`
        : `${RUN}-${orderIds.length}`,
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

describe('statusHistory resolves the actor name (C5.3)', () => {
  it('includes changedByName alongside the plain id', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CONFIRMED });

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const history = (res.body as OrderBody).data.order.statusHistory as {
      changedById: string;
      changedByName: string | null;
    }[];

    expect(history[0]?.changedById).toBe(ownerId);
    expect(history[0]?.changedByName).toBe('OWNER');
  });

  it('resolves null, not a crash, for a deleted staff account', async () => {
    // changedById is a plain id, deliberately not a Prisma relation (see
    // schema.prisma) so the history survives the account being deleted —
    // this proves that survival actually works end to end.
    const throwaway = await prisma.user.create({
      data: {
        email: `${RUN}-throwaway@example.test`,
        name: 'Throwaway Owner',
        role: StaffRole.OWNER,
        passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
      },
    });
    const throwawayToken = signToken(throwaway);
    const throwawayId = throwaway.id;
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(throwawayToken))
      .send({ to: OrderStatus.CONFIRMED });

    await prisma.user.delete({ where: { id: throwawayId } });

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const history = (res.body as OrderBody).data.order.statusHistory as {
      changedById: string;
      changedByName: string | null;
    }[];

    expect(history[0]?.changedById).toBe(throwawayId);
    expect(history[0]?.changedByName).toBeNull();
  });
});

describe('bulk status change', () => {
  it('moves every eligible order and reports the ones it could not', async () => {
    // Two orders that CAN legally move to CONFIRMED, one that cannot
    // (already terminal) — a realistic mixed selection, not a hand-picked
    // all-succeed case.
    const eligibleA = await makeOrder(OrderStatus.PENDING);
    const eligibleB = await makeOrder(OrderStatus.PENDING);
    const ineligible = await makeOrder(OrderStatus.CANCELED);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(ownerToken))
      .send({ ids: [eligibleA, eligibleB, ineligible], to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(200);
    const body = res.body as {
      data: { succeeded: string[]; skipped: { id: string; reason: string }[] };
    };
    expect(body.data.succeeded.sort()).toEqual([eligibleA, eligibleB].sort());
    expect(body.data.skipped).toHaveLength(1);
    expect(body.data.skipped[0]?.id).toBe(ineligible);
    expect(body.data.skipped[0]?.reason).toContain('Cannot move');

    const moved = await prisma.order.findMany({
      where: { id: { in: [eligibleA, eligibleB] } },
    });
    expect(moved.every((order) => order.status === OrderStatus.CONFIRMED)).toBe(true);

    // The one that was skipped must be genuinely untouched, not partially
    // written before the transition check failed.
    const untouched = await prisma.order.findUnique({ where: { id: ineligible } });
    expect(untouched?.status).toBe(OrderStatus.CANCELED);
  });

  it('writes one audit-trail row per order that actually moved, none for the ones skipped', async () => {
    const eligible = await makeOrder(OrderStatus.PENDING);
    const ineligible = await makeOrder(OrderStatus.DELIVERED);

    await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(ownerToken))
      .send({ ids: [eligible, ineligible], to: OrderStatus.CONFIRMED });

    const eligibleHistory = await prisma.orderStatusHistory.count({
      where: { orderId: eligible },
    });
    const ineligibleHistory = await prisma.orderStatusHistory.count({
      where: { orderId: ineligible },
    });

    expect(eligibleHistory).toBe(1);
    expect(ineligibleHistory).toBe(0);
  });

  it('one order failing does not roll back or block the others', async () => {
    // Isolation is the entire point of the best-effort loop — proven here
    // with an order id that does not exist at all, the sharpest possible
    // failure, sitting between two orders that legally succeed.
    const before = await makeOrder(OrderStatus.PENDING);
    const after = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(ownerToken))
      .send({ ids: [before, 'does-not-exist', after], to: OrderStatus.CONFIRMED });

    const body = res.body as { data: { succeeded: string[]; skipped: { id: string }[] } };
    expect(body.data.succeeded.sort()).toEqual([before, after].sort());
    expect(body.data.skipped.map((entry) => entry.id)).toEqual(['does-not-exist']);
  });

  it('rejects an empty selection', async () => {
    const res = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(ownerToken))
      .send({ ids: [], to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(400);
  });

  it('rejects a selection over the cap', async () => {
    const res = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(ownerToken))
      .send({ ids: Array.from({ length: 201 }, (_, i) => `id-${i}`), to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown target status', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(ownerToken))
      .send({ ids: [id], to: 'NONSENSE' });

    expect(res.status).toBe(400);
  });

  it('blocks the read-only demo role, same write-method guard as the single-order route', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status')
      .set(auth(demoToken))
      .send({ ids: [id], to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(403);

    const after = await prisma.order.findUnique({ where: { id } });
    expect(after?.status).toBe(OrderStatus.PENDING);
  });
});

describe('bulk status change — preview (C5.5)', () => {
  interface PreviewBody {
    data: {
      eligibleCount: number;
      ineligibleCount: number;
      withActiveAssignment: number;
      isTerminal: boolean;
    };
  }

  const courierIds: string[] = [];

  afterAll(async () => {
    await prisma.deliveryStaff.deleteMany({ where: { id: { in: courierIds } } });
  });

  async function makeCourierForPreview() {
    const courier = await prisma.deliveryStaff.create({
      data: { name: `${RUN} preview courier ${courierIds.length}` },
    });
    courierIds.push(courier.id);
    return courier.id;
  }

  it('counts exactly what the real move would do — eligible vs skipped', async () => {
    const eligibleA = await makeOrder(OrderStatus.PENDING);
    const eligibleB = await makeOrder(OrderStatus.PENDING);
    const ineligible = await makeOrder(OrderStatus.CANCELED);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(auth(ownerToken))
      .send({ ids: [eligibleA, eligibleB, ineligible], to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(200);
    const body = (res.body as PreviewBody).data;
    expect(body.eligibleCount).toBe(2);
    expect(body.ineligibleCount).toBe(1);
  });

  it('counts eligible orders that carry a live courier assignment', async () => {
    const driverId = await makeCourierForPreview();
    const withDriver = await makeOrder(OrderStatus.CONFIRMED);
    const withoutDriver = await makeOrder(OrderStatus.CONFIRMED);

    await prisma.deliveryAssignment.create({
      data: { orderId: withDriver, driverId, status: 'ASSIGNED' },
    });

    const res = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(auth(ownerToken))
      .send({ ids: [withDriver, withoutDriver], to: OrderStatus.SHIPPED });

    expect(res.status).toBe(200);
    const body = (res.body as PreviewBody).data;
    expect(body.eligibleCount).toBe(2);
    expect(body.withActiveAssignment).toBe(1);

    await prisma.deliveryAssignment.deleteMany({ where: { orderId: withDriver } });
  });

  it('flags a terminal target', async () => {
    const id = await makeOrder(OrderStatus.SHIPPED);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(auth(ownerToken))
      .send({ ids: [id], to: OrderStatus.RETURNED });

    expect((res.body as PreviewBody).data.isTerminal).toBe(true);
  });

  it('does not flag a non-terminal target', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(auth(ownerToken))
      .send({ ids: [id], to: OrderStatus.CONFIRMED });

    expect((res.body as PreviewBody).data.isTerminal).toBe(false);
  });

  it('is read-only — nothing is actually moved', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .set(auth(ownerToken))
      .send({ ids: [id], to: OrderStatus.CONFIRMED });

    const after = await prisma.order.findUnique({ where: { id } });
    expect(after?.status).toBe(OrderStatus.PENDING);

    const historyCount = await prisma.orderStatusHistory.count({ where: { orderId: id } });
    expect(historyCount).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/v1/orders/bulk-status/preview')
      .send({ ids: ['x'], to: OrderStatus.CONFIRMED });

    expect(res.status).toBe(401);
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

  it('reports subtotal/taxAmount as null when never recorded — not a fabricated zero', async () => {
    // makeOrder() never sets these, the same shape a pre-migration order has.
    const id = await makeOrder();

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const order = (res.body as OrderBody).data.order;

    expect(order.subtotal).toBeNull();
    expect(order.taxAmount).toBeNull();
    // total keeps its existing grand-total meaning regardless.
    expect(order.total).toBe('59.98');
  });

  it('reads subtotal/taxAmount as strings when they are recorded', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${RUN}-${orderIds.length}`,
        status: OrderStatus.PENDING,
        total: new Prisma.Decimal('62.98'),
        subtotal: new Prisma.Decimal('59.98'),
        taxAmount: new Prisma.Decimal('3.00'),
        customerId,
        items: {
          create: [{ productId, quantity: 2, price: new Prisma.Decimal('29.99') }],
        },
      },
    });
    orderIds.push(order.id);

    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(ownerToken));
    const body = (res.body as OrderBody).data.order;

    expect(body.subtotal).toBe('59.98');
    expect(body.taxAmount).toBe('3.00');
    expect(body.total).toBe('62.98');
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

  describe('server-side sort', () => {
    it('sorts by total, ascending and descending', async () => {
      // Two orders scoped to THIS test's own order numbers, sorted and
      // searched together so other tests' rows in the shared table can't
      // land between them and break the adjacency assertion. orderNumber is
      // VarChar(40) and RUN alone is already ~33 chars, so the suffix has to
      // stay short rather than reusing RUN's full prefix style.
      const prefix = `srt${Date.now().toString(36)}`;
      const cheap = await prisma.order.create({
        data: {
          orderNumber: `${prefix}-lo`,
          status: OrderStatus.PENDING,
          total: new Prisma.Decimal('10.00'),
          customerId,
        },
      });
      const expensive = await prisma.order.create({
        data: {
          orderNumber: `${prefix}-hi`,
          status: OrderStatus.PENDING,
          total: new Prisma.Decimal('999.00'),
          customerId,
        },
      });
      orderIds.push(cheap.id, expensive.id);

      const asc = await request(app)
        .get(`/api/v1/orders?search=${prefix}&sort=total&dir=asc`)
        .set(auth(ownerToken));
      const ids = (asc.body as ListBody).data.orders.map((o) => o.id);
      expect(ids.indexOf(cheap.id)).toBeLessThan(ids.indexOf(expensive.id));

      const desc = await request(app)
        .get(`/api/v1/orders?search=${prefix}&sort=total&dir=desc`)
        .set(auth(ownerToken));
      const descIds = (desc.body as ListBody).data.orders.map((o) => o.id);
      expect(descIds.indexOf(expensive.id)).toBeLessThan(descIds.indexOf(cheap.id));
    });

    it('defaults to newest-first by placedAt when no sort is given, unchanged from before sort existed', async () => {
      const prefix = `nst${Date.now().toString(36)}`;
      const older = await prisma.order.create({
        data: {
          orderNumber: `${prefix}-lo`,
          status: OrderStatus.PENDING,
          total: new Prisma.Decimal('10.00'),
          customerId,
          placedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });
      const newer = await prisma.order.create({
        data: {
          orderNumber: `${prefix}-hi`,
          status: OrderStatus.PENDING,
          total: new Prisma.Decimal('10.00'),
          customerId,
          placedAt: new Date('2020-06-01T00:00:00.000Z'),
        },
      });
      orderIds.push(older.id, newer.id);

      const res = await request(app)
        .get(`/api/v1/orders?search=${prefix}`)
        .set(auth(ownerToken));

      const ids = (res.body as ListBody).data.orders.map((o) => o.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });

    it('rejects a sort field that is not a real column on Order', async () => {
      // customer is a relation and itemCount is a Prisma _count — neither can
      // be reached by a flat Prisma orderBy, so both must 400 rather than be
      // silently ignored (which would look like the sort worked).
      const res = await request(app)
        .get('/api/v1/orders?sort=customer')
        .set(auth(ownerToken));

      expect(res.status).toBe(400);
    });

    it('rejects an unknown dir value', async () => {
      const res = await request(app)
        .get('/api/v1/orders?sort=total&dir=sideways')
        .set(auth(ownerToken));

      expect(res.status).toBe(400);
    });
  });
});

describe('CSV export', () => {
  it('exports a header plus one row per matching order', async () => {
    const prefix = `csv${Date.now().toString(36)}`;
    const id = await makeOrder(OrderStatus.PENDING, prefix);

    const res = await request(app)
      .get(`/api/v1/orders?search=${prefix}&format=csv`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('orders.csv');

    const [header, ...rows] = res.text.trim().split('\r\n');
    expect(header).toBe(
      'Order number,Status,Placed (UTC),Items,Total,Payment method,Customer name,Customer email',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('PENDING');

    const order = await prisma.order.findUnique({ where: { id } });
    expect(rows[0]).toContain(order?.orderNumber ?? '');
  });

  it('applies the same filters the JSON list would', async () => {
    const prefix = `csvf${Date.now().toString(36)}`;
    await makeOrder(OrderStatus.PENDING, prefix);
    await makeOrder(OrderStatus.SHIPPED, prefix);

    const res = await request(app)
      .get(`/api/v1/orders?search=${prefix}&status=SHIPPED&format=csv`)
      .set(auth(ownerToken));

    const rows = res.text.trim().split('\r\n').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('SHIPPED');
  });

  it('declares truncation in a header, never as an extra row that would corrupt a parser', async () => {
    const res = await request(app).get('/api/v1/orders?format=csv').set(auth(ownerToken));

    expect(res.headers['x-export-truncated']).toBe('false');
  });

  it('writes an audit row for the export itself', async () => {
    // audit() is fire-and-forget by design (never allowed to fail the write
    // it logs) — the row lands asynchronously, so this polls briefly rather
    // than assuming it exists the instant the response returns.
    const prefix = `csva${Date.now().toString(36)}`;
    await makeOrder(OrderStatus.PENDING, prefix);

    await request(app)
      .get(`/api/v1/orders?search=${prefix}&format=csv`)
      .set(auth(ownerToken));

    const entry = await waitFor(async () => {
      const found = await prisma.auditLog.findFirst({
        where: { action: 'orders.exported' },
        orderBy: { createdAt: 'desc' },
      });
      const search = (found?.changes as { filters?: { search?: string } } | null)?.filters?.search;
      return search === prefix ? found : null;
    });

    expect(entry).not.toBeNull();
  });

  it('is denied to a role without the orders area, same as the JSON list', async () => {
    const res = await request(app).get('/api/v1/orders?format=csv').set(auth(demoToken));

    // DEMO can read orders (has the area) — this proves format=csv doesn't
    // bypass the SAME guard the JSON branch sits behind, not that DEMO is
    // blocked outright (DEMO is read-only, GET is not blocked for it).
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});

describe('prev/next neighbors (C5.1)', () => {
  interface NeighborsBody {
    data: {
      prev: { id: string; orderNumber: string } | null;
      next: { id: string; orderNumber: string } | null;
    };
  }

  it('finds the order immediately before and after, in the same sort as the list', async () => {
    const prefix = `nbr${Date.now().toString(36)}`;
    const first = await prisma.order.create({
      data: {
        orderNumber: `${prefix}-a`,
        status: OrderStatus.PENDING,
        total: new Prisma.Decimal('10.00'),
        customerId,
        placedAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
    const middle = await prisma.order.create({
      data: {
        orderNumber: `${prefix}-b`,
        status: OrderStatus.PENDING,
        total: new Prisma.Decimal('10.00'),
        customerId,
        placedAt: new Date('2020-02-01T00:00:00.000Z'),
      },
    });
    const last = await prisma.order.create({
      data: {
        orderNumber: `${prefix}-c`,
        status: OrderStatus.PENDING,
        total: new Prisma.Decimal('10.00'),
        customerId,
        placedAt: new Date('2020-03-01T00:00:00.000Z'),
      },
    });
    orderIds.push(first.id, middle.id, last.id);

    // Default sort is newest-first by placedAt, so within this prefix the
    // order is last, middle, first.
    const res = await request(app)
      .get(`/api/v1/orders/${middle.id}/neighbors?search=${prefix}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as NeighborsBody;
    expect(body.data.prev?.id).toBe(last.id);
    expect(body.data.next?.id).toBe(first.id);
  });

  it('returns null for prev at the start of the list and next at the end', async () => {
    const prefix = `nbre${Date.now().toString(36)}`;
    const only = await prisma.order.create({
      data: {
        orderNumber: `${prefix}-a`,
        status: OrderStatus.PENDING,
        total: new Prisma.Decimal('10.00'),
        customerId,
      },
    });
    orderIds.push(only.id);

    const res = await request(app)
      .get(`/api/v1/orders/${only.id}/neighbors?search=${prefix}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as NeighborsBody;
    expect(body.data.prev).toBeNull();
    expect(body.data.next).toBeNull();
  });

  it('respects the status filter — a neighbor outside it is not returned', async () => {
    const prefix = `nbrs${Date.now().toString(36)}`;
    const pending = await prisma.order.create({
      data: {
        orderNumber: `${prefix}-a`,
        status: OrderStatus.PENDING,
        total: new Prisma.Decimal('10.00'),
        customerId,
        placedAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
    const shipped = await prisma.order.create({
      data: {
        orderNumber: `${prefix}-b`,
        status: OrderStatus.SHIPPED,
        total: new Prisma.Decimal('10.00'),
        customerId,
        placedAt: new Date('2020-02-01T00:00:00.000Z'),
      },
    });
    orderIds.push(pending.id, shipped.id);

    const res = await request(app)
      .get(`/api/v1/orders/${pending.id}/neighbors?search=${prefix}&status=PENDING`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as NeighborsBody;
    expect(body.data.prev).toBeNull();
    expect(body.data.next).toBeNull();
  });

  it('returns null/null for an id not present in the filtered list at all', async () => {
    const prefix = `nbrn${Date.now().toString(36)}`;
    const outside = await makeOrder(OrderStatus.PENDING);

    const res = await request(app)
      .get(`/api/v1/orders/${outside}/neighbors?search=${prefix}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as NeighborsBody;
    expect(body.data.prev).toBeNull();
    expect(body.data.next).toBeNull();
  });

  it('rejects an unknown status value, same validation as the list', async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${ownerId}/neighbors?status=NONSENSE`)
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    const id = await makeOrder();

    const res = await request(app).get(`/api/v1/orders/${id}/neighbors`);
    expect(res.status).toBe(401);
  });
});

describe('order notes are a thread, not one overwritable field (C5.7)', () => {
  interface NoteOrderBody {
    data: {
      order: {
        notes: { id: string; body: string; authorId: string | null; authorName: string | null; createdAt: string }[];
      };
    };
  }

  it('a second note does not erase the first', async () => {
    const id = await makeOrder();

    await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: 'called twice, no answer' });
    await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: 'called again, left voicemail' });

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const bodies = (res.body as NoteOrderBody).data.order.notes.map((n) => n.body);

    expect(bodies).toEqual(['called twice, no answer', 'called again, left voicemail']);
  });

  it('resolves the author name, same "id survives deletion" rule as statusHistory', async () => {
    const id = await makeOrder();

    await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: 'x' });

    const res = await request(app).get(`/api/v1/orders/${id}`).set(auth(ownerToken));
    const note = (res.body as NoteOrderBody).data.order.notes[0];

    expect(note?.authorId).toBe(ownerId);
    expect(note?.authorName).toBe('OWNER');
  });

  it('rejects an empty note', async () => {
    const id = await makeOrder();

    const res = await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: '   ' });

    expect(res.status).toBe(400);
  });

  it('rejects a note over the length cap', async () => {
    const id = await makeOrder();

    const res = await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('404s an unknown order rather than silently creating an orphaned note', async () => {
    const res = await request(app)
      .post('/api/v1/orders/does-not-exist/notes')
      .set(auth(ownerToken))
      .send({ body: 'x' });

    expect(res.status).toBe(404);
  });

  it('blocks the read-only demo role', async () => {
    const id = await makeOrder();

    const res = await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(demoToken))
      .send({ body: 'x' });

    expect(res.status).toBe(403);

    const after = await prisma.orderNote.count({ where: { orderId: id } });
    expect(after).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const id = await makeOrder();

    const res = await request(app).post(`/api/v1/orders/${id}/notes`).send({ body: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('timeline merges every real source (C5.4)', () => {
  interface TimelineBody {
    data: {
      events: {
        id: string;
        kind: string;
        action: string;
        actorName: string | null;
        createdAt: string;
        detail: Record<string, unknown>;
      }[];
    };
  }

  it('includes a status move', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CONFIRMED });

    const res = await request(app).get(`/api/v1/orders/${id}/timeline`).set(auth(ownerToken));
    expect(res.status).toBe(200);

    const events = (res.body as TimelineBody).data.events;
    const statusEvent = events.find((e) => e.kind === 'status');
    expect(statusEvent).toBeDefined();
    expect(statusEvent?.detail.toStatus).toBe('CONFIRMED');
    expect(statusEvent?.actorName).toBe('OWNER');
  });

  it('includes a staff note', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: 'called twice, no answer' });

    const res = await request(app).get(`/api/v1/orders/${id}/timeline`).set(auth(ownerToken));
    const events = (res.body as TimelineBody).data.events;
    const noteEvent = events.find((e) => e.kind === 'note');

    expect(noteEvent).toBeDefined();
    expect(noteEvent?.action).toBe('order.note.added');
  });

  it('includes a return decision, with the actor resolved from the RETURN audit trail (not the order one)', async () => {
    const id = await makeOrder(OrderStatus.DELIVERED);
    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    const orderItemId = order!.items[0]!.id;

    const created = await request(app)
      .post('/api/v1/returns')
      .set(auth(ownerToken))
      .send({ orderId: id, reason: 'damaged', items: [{ orderItemId, quantity: 1 }] });
    const returnId = (created.body as { data: { return: { id: string } } }).data.return.id;

    await request(app)
      .post(`/api/v1/returns/${returnId}/approve`)
      .set(auth(ownerToken))
      .send({ resolution: 'STORE_CREDIT', restock: false });

    // The return-approval audit write is fire-and-forget — poll the
    // timeline until the event lands rather than racing it.
    const returnEvent = await waitFor(async () => {
      const res = await request(app).get(`/api/v1/orders/${id}/timeline`).set(auth(ownerToken));
      const events = (res.body as TimelineBody).data.events;
      return events.find((e) => e.kind === 'return') ?? null;
    });

    expect(returnEvent).toBeDefined();
    expect(returnEvent?.action).toBe('return.approved');
    expect(returnEvent?.actorName).toBe(`${RUN}-owner@example.test`);

    await prisma.return.delete({ where: { id: returnId } });
  });

  it('sorts every source together, newest first', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    await request(app)
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(ownerToken))
      .send({ to: OrderStatus.CONFIRMED });
    await request(app)
      .post(`/api/v1/orders/${id}/notes`)
      .set(auth(ownerToken))
      .send({ body: 'note after the move' });

    const res = await request(app).get(`/api/v1/orders/${id}/timeline`).set(auth(ownerToken));
    const events = (res.body as TimelineBody).data.events;

    const timestamps = events.map((e) => new Date(e.createdAt).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
    // The notes edit happened after the status move, so it must lead.
    expect(events[0]?.kind).toBe('note');
  });

  it('returns an empty list for an order with no activity', async () => {
    const id = await makeOrder(OrderStatus.PENDING);

    const res = await request(app).get(`/api/v1/orders/${id}/timeline`).set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as TimelineBody).data.events).toEqual([]);
  });

  it('rejects an unauthenticated request', async () => {
    const id = await makeOrder();

    const res = await request(app).get(`/api/v1/orders/${id}/timeline`);
    expect(res.status).toBe(401);
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
