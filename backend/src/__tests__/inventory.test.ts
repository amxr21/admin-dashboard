import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

function saveSetting(body: Record<string, unknown>) {
  return request(app).patch('/api/v1/settings').set(auth(ownerToken)).send(body);
}

/** notify() is fire-and-forget — give its write a moment to land. */
function waitForNotify() {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

/**
 * audit() is fire-and-forget for the same reason notify() is — it must never
 * fail the write it records — so poll rather than asserting immediately after
 * the response. Polling, not a flat sleep, so a fast machine does not pay for
 * a slow one's worst case.
 */
async function waitForAuditEntry(action: string, entityId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entry = await prisma.auditLog.findFirst({
      where: { action, entityId },
      orderBy: { createdAt: 'desc' },
    });
    if (entry) return entry;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
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
  // Audit rows are not cascaded — `entityId` is a plain id, not a relation,
  // exactly so the trail outlives what it describes. So they need clearing by
  // hand or this run's entries leak into the next one's assertions.
  await prisma.auditLog.deleteMany({ where: { entityId: { in: productIds } } });
  // Movements cascade from the product.
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { title: { contains: RUN } } });
  // Suppliers are not cascaded from the product — the movement's FK is
  // SetNull precisely so stock history survives a deleted supplier.
  await prisma.supplier.deleteMany({ where: { name: { contains: RUN } } });
  await prisma.setting.deleteMany({
    where: { key: { in: ['inventory.lowStockThreshold', 'notifications.lowStockAlerts'] } },
  });
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

/**
 * F6.2 — a stock movement has to reach the AUDIT TRAIL, not only its own log.
 *
 * `StockMovement.actorId` always recorded who moved stock, so the fact was
 * never lost — but it was visible only by opening that one product's movement
 * log. It never appeared in /admin/audit and getStaffActivity never counted
 * it, so "what did this person do today" silently omitted counting stock,
 * which for a shift worker is most of the job.
 */
describe('a stock movement is auditable, not just logged', () => {
  it('writes an audit entry naming the actor, the delta and the resulting stock', async () => {
    const id = await makeProduct(10);

    await adjust(id, { delta: -4, reason: 'DAMAGED', note: 'dropped' });

    // audit() is deliberately fire-and-forget (it must never fail the write it
    // records), so the row can land just after the response.
    const entry = await waitForAuditEntry('inventory.stock.adjusted', id);

    expect(entry).toBeTruthy();
    expect(entry?.actorId).toBe(ownerId);
    expect(entry?.entity).toBe('product');
    // The delta alone is not reviewable — "-4" invites "from what?".
    expect(entry?.changes).toMatchObject({
      stock: { from: 10, to: 6 },
      delta: { to: -4 },
      reason: { to: 'DAMAGED' },
    });
  });

  it('writes NO audit entry when the adjustment was refused', async () => {
    // An entry for a movement that rolled back would record something that
    // never happened — worse than no entry at all.
    const id = await makeProduct(3);

    expect((await adjust(id, { delta: -5, reason: 'DAMAGED' })).status).toBe(400);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      await prisma.auditLog.count({
        where: { action: 'inventory.stock.adjusted', entityId: id },
      }),
    ).toBe(0);
  });
});

/**
 * F1.4a — per-batch acquisition cost.
 *
 * Records what a given delivery cost, so cost drift over time is visible
 * rather than collapsed into the product's single current `cost`. It is NOT
 * consumed by profit reporting: COGS reads `OrderItem.cost`, the snapshot
 * taken at sale time.
 */
describe('a received batch can record what it cost', () => {
  it('stores the unit cost on the movement, as a 2dp string', async () => {
    const id = await makeProduct(0);

    const res = await adjust(id, { delta: 10, reason: 'RECEIVED', unitCost: '4.25' });

    expect(res.status).toBe(201);
    expect((res.body as { data: { movement: { unitCost: string | null } } }).data.movement.unitCost)
      .toBe('4.25');
  });

  it('leaves unitCost null when none was given — not zero', async () => {
    // "Not recorded" and "cost nothing" are different facts, and only one of
    // them is true of a batch nobody priced.
    const id = await makeProduct(0);

    await adjust(id, { delta: 5, reason: 'RECEIVED' });

    const movement = await prisma.stockMovement.findFirst({ where: { productId: id } });
    expect(movement?.unitCost).toBeNull();
  });

  it('accepts a genuine zero, which is not the same as absent', async () => {
    // Free stock — a supplier sample, a warranty replacement — is a real
    // acquisition at a real cost of nothing.
    const id = await makeProduct(0);

    const res = await adjust(id, { delta: 2, reason: 'RECEIVED', unitCost: '0' });

    expect(res.status).toBe(201);
    const movement = await prisma.stockMovement.findFirst({ where: { productId: id } });
    expect(movement?.unitCost?.toFixed(2)).toBe('0.00');
  });

  it('refuses a unit cost on an OUTGOING movement', async () => {
    // A DAMAGED/LOST/SOLD movement has no acquisition cost. Accepting one
    // would store a number nothing can interpret; ignoring it silently would
    // lose data the user believed they had entered.
    const id = await makeProduct(10);

    const res = await adjust(id, { delta: -2, reason: 'DAMAGED', unitCost: '4.25' });

    expect(res.status).toBe(400);
    expect(await prisma.stockMovement.count({ where: { productId: id } })).toBe(0);
  });

  it('rejects a malformed amount rather than rounding it', async () => {
    const id = await makeProduct(0);

    expect((await adjust(id, { delta: 1, reason: 'RECEIVED', unitCost: '4.256' })).status).toBe(400);
    expect((await adjust(id, { delta: 1, reason: 'RECEIVED', unitCost: 'free' })).status).toBe(400);
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

describe('the live threshold follows the setting, not just the constant', () => {
  afterEach(async () => {
    await prisma.setting.deleteMany({ where: { key: 'inventory.lowStockThreshold' } });
  });

  it('an explicit ?threshold= still wins over the setting', async () => {
    await saveSetting({ 'inventory.lowStockThreshold': 30 });

    const res = await request(app)
      .get('/api/v1/inventory?threshold=7')
      .set(auth(ownerToken));

    expect((res.body as ListBody).data.threshold).toBe(7);
  });

  it('with no explicit threshold, a saved setting changes what counts as low', async () => {
    await saveSetting({ 'inventory.lowStockThreshold': 60 });

    const id = await makeProduct(50);

    const res = await request(app)
      .get(`/api/v1/inventory?lowStock=true&pageSize=100&search=${RUN}`)
      .set(auth(ownerToken));

    const row = (res.body as ListBody).data.products.find((p) => p.id === id);
    expect(row).toBeTruthy();
    expect((res.body as ListBody).data.threshold).toBe(60);
  });
});

describe('crossing into low stock notifies staff', () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { title: { contains: RUN } } });
    await prisma.setting.deleteMany({
      where: { key: { in: ['inventory.lowStockThreshold', 'notifications.lowStockAlerts'] } },
    });
  });

  it('fires once when a movement crosses at-or-below the threshold', async () => {
    await saveSetting({ 'inventory.lowStockThreshold': 10 });
    const id = await makeProduct(20);
    const product = await prisma.product.findUniqueOrThrow({ where: { id } });

    // 20 -> 15: still above 10, no crossing yet.
    await adjust(id, { delta: -5, reason: 'SOLD' });
    await waitForNotify();
    expect(
      await prisma.notification.count({
        where: { type: 'inventory.low-stock', title: product.name },
      }),
    ).toBe(0);

    // 15 -> 8: crosses the threshold.
    await adjust(id, { delta: -7, reason: 'SOLD' });
    await waitForNotify();
    expect(
      await prisma.notification.count({
        where: { type: 'inventory.low-stock', title: product.name },
      }),
    ).toBe(1);

    // 8 -> 5: still low, but not a NEW crossing — must not renotify.
    await adjust(id, { delta: -3, reason: 'SOLD' });
    await waitForNotify();
    expect(
      await prisma.notification.count({
        where: { type: 'inventory.low-stock', title: product.name },
      }),
    ).toBe(1);
  });

  it('does not fire when notifications.lowStockAlerts is off', async () => {
    await saveSetting({ 'inventory.lowStockThreshold': 10, 'notifications.lowStockAlerts': false });
    const id = await makeProduct(20);
    const product = await prisma.product.findUniqueOrThrow({ where: { id } });

    await adjust(id, { delta: -15, reason: 'SOLD' });
    await waitForNotify();

    expect(
      await prisma.notification.count({
        where: { type: 'inventory.low-stock', title: product.name },
      }),
    ).toBe(0);
  });
});

describe('a received batch records its own delivery detail (F7.8)', () => {
  /**
   * The owner's case, 2026-09-08: "buy the stock of 50 units then enter one
   * unit details once". A receipt of 50 is ALREADY one movement row, so the
   * batch's facts belong on that row — not on `Product`, where a column could
   * hold only the most recent delivery and would silently overwrite the
   * history this log exists to keep.
   *
   * Per-unit serials were considered and are NOT what was asked for: they
   * need a different inventory model entirely, since a count plus a movement
   * log cannot express "unit #47 came back faulty".
   */
  async function makeSupplier(name: string) {
    const supplier = await prisma.supplier.create({ data: { name } });
    return supplier.id;
  }

  it('stores the dates, reference and supplier on the movement', async () => {
    const id = await makeProduct(0);
    const supplierId = await makeSupplier(`${RUN} Acme Coffee`);

    const res = await adjust(id, {
      delta: 50,
      reason: 'RECEIVED',
      unitCost: '3.10',
      deliveredAt: '2026-08-20T09:00:00.000Z',
      purchasedAt: '2026-08-12T00:00:00.000Z',
      reference: 'INV-88213',
      supplierId,
    });

    expect(res.status).toBe(201);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: id },
      select: {
        delta: true,
        deliveredAt: true,
        purchasedAt: true,
        reference: true,
        supplierId: true,
      },
    });

    // ONE row for fifty units — the whole point.
    expect(movement?.delta).toBe(50);
    expect(movement?.reference).toBe('INV-88213');
    expect(movement?.supplierId).toBe(supplierId);
    expect(movement?.deliveredAt?.toISOString()).toBe('2026-08-20T09:00:00.000Z');
    expect(movement?.purchasedAt?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('keeps delivery date separate from when it was recorded', async () => {
    // A batch entered the next morning has a `createdAt` of today and a
    // `deliveredAt` of yesterday. Collapsing them would make "how long does
    // this supplier take" unanswerable.
    const id = await makeProduct(0);

    await adjust(id, {
      delta: 5,
      reason: 'RECEIVED',
      deliveredAt: '2026-08-01T00:00:00.000Z',
    });

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: id },
      select: { deliveredAt: true, createdAt: true },
    });

    expect(movement?.deliveredAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(movement?.createdAt.getTime()).toBeGreaterThan(
      movement!.deliveredAt!.getTime(),
    );
  });

  it('refuses delivery detail on an OUTGOING movement', async () => {
    // Nothing was delivered when stock is written off as damaged. Storing a
    // delivery date there would be a fact nothing can interpret later, and
    // dropping it silently would lose data the user believed they entered.
    const id = await makeProduct(10);

    const res = await adjust(id, {
      delta: -2,
      reason: 'DAMAGED',
      deliveredAt: '2026-08-20T09:00:00.000Z',
    });

    expect(res.status).toBe(400);
  });

  it('400s on a supplier that does not exist, naming the field', async () => {
    // Left to the foreign key this would be a raw Prisma violation — a 500
    // naming a constraint, which tells whoever is receiving stock nothing.
    const id = await makeProduct(0);

    const res = await adjust(id, {
      delta: 5,
      reason: 'RECEIVED',
      supplierId: 'no-such-supplier',
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/supplier/i);

    // Nothing was written — a rejected receipt must not move stock.
    const count = await prisma.stockMovement.count({ where: { productId: id } });
    expect(count).toBe(0);
  });

  it('leaves the batch fields null when none are given', async () => {
    // Every field is optional: an owner receiving stock without paperwork
    // must not be blocked, and a null is honest where an invented date is not.
    const id = await makeProduct(0);

    await adjust(id, { delta: 3, reason: 'RECEIVED' });

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: id },
      select: { deliveredAt: true, purchasedAt: true, reference: true, supplierId: true },
    });

    expect(movement?.deliveredAt).toBeNull();
    expect(movement?.purchasedAt).toBeNull();
    expect(movement?.reference).toBeNull();
    expect(movement?.supplierId).toBeNull();
  });

  it('surfaces the batch detail in the movement log', async () => {
    const id = await makeProduct(0);
    const supplierId = await makeSupplier(`${RUN} Bean Bros`);

    await adjust(id, {
      delta: 20,
      reason: 'RECEIVED',
      reference: 'DN-4471',
      supplierId,
    });

    const res = await request(app)
      .get(`/api/v1/inventory/${id}/movements`)
      .set(auth(ownerToken));

    const first = (
      res.body as {
        data: { movements: { reference: string | null; supplier: { name: string } | null }[] };
      }
    ).data.movements[0];

    // The log answers "where did this come from" without a second lookup.
    expect(first?.reference).toBe('DN-4471');
    expect(first?.supplier?.name).toContain('Bean Bros');
  });
});

describe('receiving a whole delivery at once (F3.5)', () => {
  /**
   * A delivery note lists many products; entering them one at a time is the
   * friction this removes. Deliberately NOT the generic resource import: that
   * one is create-only and writes rows of a configured resource, while a
   * delivery UPDATES stock — and inventory is not a configured resource at
   * all, because stock is an append-only movement log rather than an editable
   * number.
   *
   * The two rules worth protecting are all-or-nothing (a half-received
   * delivery matches neither the paperwork nor the shelf) and the duplicate
   * refusal (silently summing two lines doubles the stock with nothing on
   * screen to explain it).
   */
  async function makeCoded(sku: string, barcode?: string) {
    const product = await prisma.product.create({
      data: {
        name: `${RUN} ${sku}`,
        price: new Prisma.Decimal('9.99'),
        stock: 0,
        sku: `${RUN}-${sku}`,
        ...(barcode ? { barcode: `${RUN}-${barcode}` } : {}),
      },
    });
    productIds.push(product.id);
    return product;
  }

  function receive(body: Record<string, unknown>, path = '/api/v1/inventory/receive') {
    return request(app).post(path).set(auth(ownerToken)).send(body);
  }

  it('receives every line and moves the stock', async () => {
    const a = await makeCoded('BULK-A');
    const b = await makeCoded('BULK-B');

    const res = await receive({
      reference: 'DN-9001',
      lines: [
        { sku: a.sku, quantity: 12 },
        { sku: b.sku, quantity: 5 },
      ],
    });

    expect(res.status).toBe(201);
    expect((res.body as { data: { received: number } }).data.received).toBe(2);

    const after = await prisma.product.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, stock: true },
      orderBy: { sku: 'asc' },
    });

    expect(after.map((p) => p.stock)).toEqual([12, 5]);
  });

  it('matches on barcode as well as SKU', async () => {
    // A supplier's paperwork carries whichever code they use, not the one
    // this shop happens to file by.
    const product = await makeCoded('BULK-C', 'EAN-C');

    const res = await receive({ lines: [{ barcode: product.barcode, quantity: 4 }] });

    expect(res.status).toBe(201);

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after?.stock).toBe(4);
  });

  it('writes NOTHING when any line is bad', async () => {
    // All-or-nothing. Receiving "1 of 2" leaves a shop whose counted stock
    // matches neither the delivery note nor the shelf, and the line that
    // failed is the one nobody remembers to chase.
    const good = await makeCoded('BULK-D');

    const res = await receive({
      lines: [
        { sku: good.sku, quantity: 10 },
        { sku: `${RUN}-NOT-A-REAL-SKU`, quantity: 3 },
      ],
    });

    expect(res.status).toBe(200);
    expect((res.body as { data: { received: number } }).data.received).toBe(0);

    const after = await prisma.product.findUnique({ where: { id: good.id } });
    expect(after?.stock).toBe(0);
  });

  it('refuses the same product on two lines rather than summing them', async () => {
    // Two lines for one product is usually a duplicated row. Adding them
    // silently doubles the stock with nothing on screen to explain it.
    const product = await makeCoded('BULK-E');

    const res = await receive({
      lines: [
        { sku: product.sku, quantity: 6 },
        { sku: product.sku, quantity: 6 },
      ],
    });

    expect((res.body as { data: { received: number } }).data.received).toBe(0);

    const errors = (res.body as { data: { errors: { line: number; message: string }[] } }).data
      .errors;
    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.message).toMatch(/already on line 1/i);
  });

  it('rejects a zero or negative quantity per line', async () => {
    // Receiving zero is not a delivery, and a negative is a write-off that
    // belongs on its own movement with its own reason.
    const product = await makeCoded('BULK-F');

    const res = await receive({ lines: [{ sku: product.sku, quantity: 0 }] });

    expect((res.body as { data: { received: number } }).data.received).toBe(0);
    expect(
      (res.body as { data: { errors: { message: string }[] } }).data.errors[0]?.message,
    ).toMatch(/above zero/i);
  });

  it('previews without writing anything', async () => {
    // The operator sees which lines resolved to which product NAMES before
    // committing — a SKU typo matching a different real product is otherwise
    // invisible until the stock is wrong.
    const product = await makeCoded('BULK-G');

    const res = await receive(
      { lines: [{ sku: product.sku, quantity: 7 }] },
      '/api/v1/inventory/receive/preview',
    );

    expect(res.status).toBe(200);

    const body = res.body as { data: { validLines: number; resolved: { name: string }[] } };
    expect(body.data.validLines).toBe(1);
    expect(body.data.resolved[0]?.name).toContain('BULK-G');

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after?.stock).toBe(0);
  });

  it('carries the batch detail onto every line', async () => {
    // One delivery note covers all of them; a movement that lost its supplier
    // would leave "where did this come from" unanswerable for that product
    // alone (F7.8).
    const supplier = await prisma.supplier.create({ data: { name: `${RUN} Bulk Supplies` } });
    const a = await makeCoded('BULK-H');
    const b = await makeCoded('BULK-I');

    await receive({
      supplierId: supplier.id,
      reference: 'DN-9002',
      deliveredAt: '2026-08-25T08:00:00.000Z',
      lines: [
        { sku: a.sku, quantity: 2 },
        { sku: b.sku, quantity: 3 },
      ],
    });

    const movements = await prisma.stockMovement.findMany({
      where: { productId: { in: [a.id, b.id] } },
      select: { supplierId: true, reference: true, deliveredAt: true },
    });

    expect(movements).toHaveLength(2);
    for (const movement of movements) {
      expect(movement.supplierId).toBe(supplier.id);
      expect(movement.reference).toBe('DN-9002');
      expect(movement.deliveredAt?.toISOString()).toBe('2026-08-25T08:00:00.000Z');
    }
  });

  it('needs a SKU or a barcode to identify the product', async () => {
    const res = await receive({ lines: [{ quantity: 5 }] });

    expect((res.body as { data: { received: number } }).data.received).toBe(0);
    expect(
      (res.body as { data: { errors: { message: string }[] } }).data.errors[0]?.message,
    ).toMatch(/SKU or a barcode/i);
  });
});
