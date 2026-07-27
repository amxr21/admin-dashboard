import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole, StockMovementReason } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '../services/inventory.service.js';

/**
 * Inventory.
 *
 * The property that matters is that the LOG explains the NUMBER. `stock` is a
 * denormalised running total, so the failure worth guarding is the two drifting
 * apart — which is silent, and turns the movement log from an explanation into
 * a work of fiction.
 *
 * The other half is that a refused adjustment leaves NOTHING behind: no
 * movement, no changed total. A partial write here is worse than a rejection,
 * because the count still looks plausible.
 */

const app = createApp();

interface AdjustBody {
  data: {
    product: { id: string; stock: number };
    movement: { id: string; delta: number; reason: string; actorId: string };
  };
}
interface ListBody {
  data: {
    products: { id: string; stock: number; isLow: boolean }[];
    total: number;
    threshold: number;
  };
}
interface MovementsBody {
  data: {
    product: { id: string; stock: number };
    movements: { delta: number; reason: string; note: string | null }[];
    total: number;
  };
}
interface ReconcileBody {
  data: { stock: number; fromMovements: number; agrees: boolean };
}
interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const RUN = `invtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const productIds: string[] = [];
let ownerToken = '';
let ownerId = '';
let demoToken = '';
let supportToken = '';

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

async function makeProduct(stock: number) {
  const product = await prisma.product.create({
    data: {
      name: `${RUN} widget ${productIds.length}`,
      price: new Prisma.Decimal('9.99'),
      stock,
    },
  });
  productIds.push(product.id);
  return product.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function adjust(id: string, body: Record<string, unknown>, token = ownerToken) {
  return request(app)
    .post(`/api/v1/inventory/${id}/movements`)
    .set(auth(token))
    .send(body);
}

beforeAll(async () => {
  const [owner, demo, support] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
    // SUPPORT has orders/customers/reviews but NOT inventory.
    makeUser(StaffRole.SUPPORT),
  ]);

  ownerToken = owner.token;
  ownerId = owner.id;
  demoToken = demo.token;
  supportToken = support.token;
});

afterAll(async () => {
  // Movements cascade from the product.
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('authorisation runs before anything else', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/inventory');
    expect(res.status).toBe(401);
  });

  it('denies a role without the inventory area', async () => {
    const res = await request(app).get('/api/v1/inventory').set(auth(supportToken));
    expect(res.status).toBe(403);
  });

  it('blocks the read-only demo role from adjusting, and changes nothing', async () => {
    const id = await makeProduct(10);

    const res = await adjust(id, { delta: 5, reason: 'RECEIVED' }, demoToken);

    expect(res.status).toBe(403);

    const after = await prisma.product.findUnique({ where: { id } });
    expect(after?.stock).toBe(10);
    expect(await prisma.stockMovement.count({ where: { productId: id } })).toBe(0);
  });
});

describe('the engine does not serve inventory', () => {
  it('404s /r/inventory', async () => {
    const res = await request(app).get('/api/v1/r/inventory').set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});

describe('the log explains the number', () => {
  it('moves stock and records why, in one write', async () => {
    const id = await makeProduct(10);

    const res = await adjust(id, {
      delta: 50,
      reason: 'RECEIVED',
      note: 'pallet 4',
    });

    expect(res.status).toBe(201);
    expect((res.body as AdjustBody).data.product.stock).toBe(60);
    expect((res.body as AdjustBody).data.movement.actorId).toBe(ownerId);

    const movements = await prisma.stockMovement.findMany({ where: { productId: id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: 50,
      reason: StockMovementReason.RECEIVED,
      note: 'pallet 4',
    });
  });

  it('sums every movement back to the current stock', async () => {
    /**
     * The core invariant. `stock` is denormalised, so this is the assertion
     * that the shortcut has not started lying.
     */
    const id = await makeProduct(0);

    for (const [delta, reason] of [
      [100, 'RECEIVED'],
      [-3, 'DAMAGED'],
      [-20, 'SOLD'],
      [5, 'RETURNED'],
      [-1, 'LOST'],
    ] as const) {
      await adjust(id, { delta, reason });
    }

    const res = await request(app)
      .get(`/api/v1/inventory/${id}/reconcile`)
      .set(auth(ownerToken));

    const body = (res.body as ReconcileBody).data;
    expect(body.stock).toBe(81);
    expect(body.fromMovements).toBe(81);
    expect(body.agrees).toBe(true);
  });

  it('notices when something wrote stock without recording why', async () => {
    // A direct DB edit is exactly the drift this endpoint exists to surface.
    const id = await makeProduct(0);
    await adjust(id, { delta: 10, reason: 'RECEIVED' });
    await prisma.product.update({ where: { id }, data: { stock: 999 } });

    const res = await request(app)
      .get(`/api/v1/inventory/${id}/reconcile`)
      .set(auth(ownerToken));

    expect((res.body as ReconcileBody).data.agrees).toBe(false);
  });
});

describe('a refused adjustment leaves nothing behind', () => {
  it('will not let stock go negative', async () => {
    const id = await makeProduct(3);

    const res = await adjust(id, { delta: -5, reason: 'DAMAGED' });

    expect(res.status).toBe(400);
    // The refusal names the numbers rather than just saying no.
    expect((res.body as ErrorBody).error.details).toMatchObject({ available: 3 });

    const after = await prisma.product.findUnique({ where: { id } });
    expect(after?.stock).toBe(3);
    expect(await prisma.stockMovement.count({ where: { productId: id } })).toBe(0);
  });

  it('rejects a zero adjustment', async () => {
    // Zero records an event that did not happen.
    const id = await makeProduct(5);

    expect((await adjust(id, { delta: 0, reason: 'CORRECTION' })).status).toBe(400);
    expect(await prisma.stockMovement.count({ where: { productId: id } })).toBe(0);
  });

  it('rejects a fractional adjustment', async () => {
    const id = await makeProduct(5);
    expect((await adjust(id, { delta: 1.5, reason: 'RECEIVED' })).status).toBe(400);
  });

  it('requires a reason', async () => {
    // An unexplained adjustment is indistinguishable from a mistake later.
    const id = await makeProduct(5);
    expect((await adjust(id, { delta: 1 })).status).toBe(400);
  });

  it('rejects an unknown reason rather than storing it', async () => {
    const id = await makeProduct(5);
    expect((await adjust(id, { delta: 1, reason: 'BECAUSE' })).status).toBe(400);
  });

  it('rejects an unknown field', async () => {
    // .strict() — silently accepting extras is how mass assignment creeps in.
    const id = await makeProduct(5);
    expect(
      (await adjust(id, { delta: 1, reason: 'RECEIVED', stock: 9999 })).status,
    ).toBe(400);
  });

  it('404s an unknown product without writing anything', async () => {
    const res = await adjust('does-not-exist', { delta: 1, reason: 'RECEIVED' });
    expect(res.status).toBe(404);
  });
});

describe('the log is append-only', () => {
  it('corrects a mistake with a compensating movement, keeping both', async () => {
    // The trail records what actually happened, including the error.
    const id = await makeProduct(0);

    await adjust(id, { delta: 100, reason: 'RECEIVED', note: 'miscounted' });
    await adjust(id, { delta: -90, reason: 'CORRECTION', note: 'was 10, not 100' });

    const res = await request(app)
      .get(`/api/v1/inventory/${id}/movements`)
      .set(auth(ownerToken));

    const body = (res.body as MovementsBody).data;
    expect(body.total).toBe(2);
    expect(body.product.stock).toBe(10);
    // Newest first — the recent change is what someone is checking.
    expect(body.movements[0]?.reason).toBe('CORRECTION');
  });

  it('exposes no route to edit or delete a movement', async () => {
    const id = await makeProduct(0);
    await adjust(id, { delta: 5, reason: 'RECEIVED' });
    const movement = await prisma.stockMovement.findFirst({ where: { productId: id } });

    const path = `/api/v1/inventory/${id}/movements/${movement?.id ?? 'x'}`;

    for (const method of ['patch', 'put', 'delete'] as const) {
      // Indexed off a local rather than chained off request(app), which reads
      // as a multiline property access and trips no-unexpected-multiline.
      const agent = request(app);
      const res = await agent[method](path).set(auth(ownerToken)).send({ delta: 1 });

      expect(res.status).toBe(404);
    }
  });
});

describe('the low-stock view', () => {
  it('surfaces only products at or under the threshold', async () => {
    const low = await makeProduct(1);
    const fine = await makeProduct(500);

    const res = await request(app)
      .get(`/api/v1/inventory?lowStock=true&pageSize=100&search=${RUN}`)
      .set(auth(ownerToken));

    const ids = (res.body as ListBody).data.products.map((p) => p.id);
    expect(ids).toContain(low);
    expect(ids).not.toContain(fine);
  });

  it('uses one documented default the frontend can import', async () => {
    const res = await request(app).get('/api/v1/inventory').set(auth(ownerToken));

    expect((res.body as ListBody).data.threshold).toBe(DEFAULT_LOW_STOCK_THRESHOLD);
  });

  it('honours an explicit threshold', async () => {
    const id = await makeProduct(40);

    const res = await request(app)
      .get(`/api/v1/inventory?lowStock=true&threshold=50&pageSize=100&search=${RUN}`)
      .set(auth(ownerToken));

    expect((res.body as ListBody).data.products.map((p) => p.id)).toContain(id);
  });

  it('flags each row so the UI need not recompute the rule', async () => {
    const id = await makeProduct(0);

    const res = await request(app)
      .get(`/api/v1/inventory?pageSize=100&search=${RUN}`)
      .set(auth(ownerToken));

    const row = (res.body as ListBody).data.products.find((p) => p.id === id);
    expect(row?.isLow).toBe(true);
  });

  it('caps the page size', async () => {
    const res = await request(app)
      .get('/api/v1/inventory?pageSize=100000')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as ListBody).data.products.length).toBeLessThanOrEqual(100);
  });
});
