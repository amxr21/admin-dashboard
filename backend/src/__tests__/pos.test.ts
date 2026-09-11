import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, ProductStatus, ReturnResolution, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken, verifyManagerOverride } from '../services/auth.service.js';

/**
 * The till's scan (O5.6).
 *
 * ─── THE RULE THIS SUITE PROTECTS ────────────────────────────────────
 * A scan is EXACT. `/search` and the product list answer "show me things that
 * might match"; a scan answers "this code is in my hand, give me the one
 * product it belongs to". Routing it through fuzzy matching means a mistyped
 * digit silently adds a DIFFERENT product to the basket — the customer is
 * charged for something they are not holding, and nothing on screen looks
 * wrong.
 */

const app = createApp();

const RUN = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const productIds: string[] = [];
const categoryIds: string[] = [];
const businessIds: string[] = [];
const shiftIds: string[] = [];
const orderIds: string[] = [];

let branchId = '';
let ownerToken = '';
let supportToken = '';

function auth(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': randomUUID(),
  } as const;
}

async function makeUser(role: StaffRole, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: `${RUN} ${label}`,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return user;
}

async function makeProduct(opts: {
  barcode?: string;
  sku?: string;
  name?: string;
  price?: string;
  stock?: number;
  status?: ProductStatus;
  categoryId?: string;
}) {
  const product = await prisma.product.create({
    data: {
      name: opts.name ?? `${RUN} ${opts.sku ?? opts.barcode ?? 'item'}`,
      price: new Prisma.Decimal(opts.price ?? '5.00'),
      stock: opts.stock ?? 0,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.barcode ? { barcode: opts.barcode } : {}),
      ...(opts.sku ? { sku: opts.sku } : {}),
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    },
  });
  productIds.push(product.id);
  return product;
}

async function makeCategory(name: string) {
  const category = await prisma.category.create({
    data: { name, slug: `${RUN}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` },
  });
  categoryIds.push(category.id);
  return category;
}

function browse(query: Record<string, string> = {}, token = ownerToken, branch?: string) {
  const req = request(app)
    .get('/api/v1/pos/browse')
    .query(query)
    .set(auth(token));

  return branch ? req.set('X-Branch-Id', branch) : req;
}

function browseCategoriesReq(token = ownerToken) {
  return request(app).get('/api/v1/pos/browse/categories').set(auth(token));
}

function scan(code: string, token = ownerToken, branch?: string) {
  const req = request(app)
    .get(`/api/v1/pos/scan?code=${encodeURIComponent(code)}`)
    .set(auth(token));

  return branch ? req.set('X-Branch-Id', branch) : req;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessIds.push(business.id);

  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `${RUN} Till Branch` },
  });
  branchId = branch.id;

  const [owner, support] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.SUPPORT, 'support'),
  ]);

  ownerToken = signToken(owner);
  supportToken = signToken(support);
});

afterAll(async () => {
  // Orders created BY the checkout tests — found via their line items, since
  // the sale generates its own order number.
  const sold = await prisma.orderItem.findMany({
    where: { productId: { in: productIds } },
    select: { orderId: true },
  });
  const soldOrderIds = [...new Set([...orderIds, ...sold.map((item) => item.orderId)])];

  await prisma.payment.deleteMany({ where: { orderId: { in: soldOrderIds } } });
  // Returns seeded against these orders (O9.8's exchange tests) — deleted
  // BEFORE the order itself. `ReturnItem.orderItem` is Restrict, not
  // cascade, so an order whose items a still-live return references cannot
  // be deleted first.
  await prisma.return.deleteMany({
    where: { OR: [{ orderId: { in: soldOrderIds } }, { exchangeOrderId: { in: soldOrderIds } }] },
  });
  await prisma.order.deleteMany({ where: { id: { in: soldOrderIds } } });
  await prisma.parkedSale.deleteMany({ where: { cashierId: { in: userIds } } });
  await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.branchStock.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('scanning a code', () => {
  it('finds the product by barcode', async () => {
    const product = await makeProduct({ barcode: `${RUN}-5012345678900`, price: '3.75' });

    const res = await scan(`${RUN}-5012345678900`);

    expect(res.status).toBe(200);

    const body = res.body as { data: { product: { id: string; price: string } } };
    expect(body.data.product.id).toBe(product.id);
    // A 2dp string, never a float — a till that is a cent out per hundred
    // sales cannot be reconciled.
    expect(body.data.product.price).toBe('3.75');
  });

  it('finds the product by SKU too', async () => {
    // A shop's own code is what is printed on the shelf label, and that is
    // what gets typed when a barcode will not read.
    const product = await makeProduct({ sku: `${RUN}-SKU-1` });

    const res = await scan(`${RUN}-SKU-1`);

    expect((res.body as { data: { product: { id: string } } }).data.product.id).toBe(product.id);
  });

  it('does NOT match a partial code', async () => {
    // The whole point. A prefix match would let a dropped final digit resolve
    // to a real but different product, and the customer is charged for
    // something they are not holding.
    await makeProduct({ barcode: `${RUN}-9990001112223` });

    const res = await scan(`${RUN}-999000111222`);

    expect(res.status).toBe(404);
  });

  it('does NOT match on the product name', async () => {
    // A scan is not a search. Name matching would make a typo resolve to
    // whichever product happens to be named similarly.
    const product = await makeProduct({ sku: `${RUN}-SKU-2` });

    const res = await scan(product.name);

    expect(res.status).toBe(404);
  });

  it('echoes the code back when nothing matches', async () => {
    // At a till the usual cause is a mis-scan; seeing what was actually read
    // is how somebody notices a digit was dropped.
    const res = await scan(`${RUN}-NOPE-123`);

    expect(res.status).toBe(404);
    expect((res.body as { error: { message: string } }).error.message).toContain(`${RUN}-NOPE-123`);
  });

  it('tolerates surrounding whitespace from a scanner', async () => {
    // Hardware scanners commonly append a newline or a trailing space.
    await makeProduct({ barcode: `${RUN}-7770001112223` });

    const res = await scan(`  ${RUN}-7770001112223  `);

    expect(res.status).toBe(200);
  });
});

describe('what the till is told about stock', () => {
  it('reports stock AT THE BRANCH, not the all-branch total', async () => {
    // The number the cashier can actually reach. Showing the company-wide
    // total would have them promise stock sitting in another city.
    const product = await makeProduct({ barcode: `${RUN}-8880001112223`, stock: 100 });

    await prisma.branchStock.create({
      data: { productId: product.id, branchId, quantity: 4 },
    });

    const res = await scan(`${RUN}-8880001112223`, ownerToken, branchId);

    const body = res.body as { data: { product: { branchStock: number; totalStock: number } } };
    expect(body.data.product.branchStock).toBe(4);
    // Both, so a cashier can say "none here, twelve at the warehouse" rather
    // than just "no".
    expect(body.data.product.totalStock).toBe(100);
  });

  it('reports zero, not null, for a branch holding none', async () => {
    // A branch with no BranchStock row genuinely has none of it. Null there
    // would be indistinguishable from "no branch selected".
    await makeProduct({ barcode: `${RUN}-6660001112223`, stock: 50 });

    const res = await scan(`${RUN}-6660001112223`, ownerToken, branchId);

    expect((res.body as { data: { product: { branchStock: number } } }).data.product.branchStock)
      .toBe(0);
  });

  it('returns null branch stock when no branch is in context', async () => {
    // "All branches" is a real state at a till that has not been placed yet,
    // and inventing a 0 would read as "out of stock".
    await makeProduct({ barcode: `${RUN}-5550001112223`, stock: 9 });

    const res = await scan(`${RUN}-5550001112223`);

    expect((res.body as { data: { product: { branchStock: number | null } } }).data.product.branchStock)
      .toBeNull();
  });

  it('still returns an ARCHIVED product, flagged', async () => {
    // An archived product physically on the shelf still has to be sellable.
    // Hiding it leaves a cashier holding an item the system claims not to
    // know — the till decides whether to warn, this does not decide for it.
    await makeProduct({ barcode: `${RUN}-4440001112223`, status: ProductStatus.ARCHIVED });

    const res = await scan(`${RUN}-4440001112223`);

    expect(res.status).toBe(200);
    expect((res.body as { data: { product: { status: string } } }).data.product.status).toBe(
      'ARCHIVED',
    );
  });
});

describe('who may use the till', () => {
  it('rejects an unauthenticated scan', async () => {
    const res = await request(app).get('/api/v1/pos/scan?code=anything');

    expect(res.status).toBe(401);
  });

  it('is guarded by `orders`, which every working role already holds', async () => {
    // Deliberately `orders`, not `inventory`: a scan is the first step of
    // taking an order, and requiring stock-EDITING rights to sell a coffee is
    // more authority than the job needs — the opposite of what O4 is trying
    // to correct.
    //
    // Every current role holds `orders`, so no role is refused today. That is
    // the point rather than a gap: this asserts the guard is the permissive
    // one, so the CASHIER role (O5.10) works the moment it is added.
    const { canAccessArea } = await import('../config/roles.js');

    for (const role of [
      StaffRole.OWNER,
      StaffRole.MANAGER,
      StaffRole.FULFILLMENT,
      StaffRole.SUPPORT,
      StaffRole.DEMO,
    ]) {
      expect(canAccessArea(role, 'orders')).toBe(true);
    }

    // And it is NOT behind inventory, which FULFILLMENT-and-below would need
    // stock rights for.
    const demo = await makeUser(StaffRole.DEMO, 'demo');
    const res = await scan(`${RUN}-nothing-here`, signToken(demo));

    // 404 (no such code), not 403 (not allowed to look).
    expect(res.status).toBe(404);
  });

  it('lets SUPPORT scan, since SUPPORT holds `orders`', async () => {
    await makeProduct({ barcode: `${RUN}-3330001112223` });

    const res = await scan(`${RUN}-3330001112223`, supportToken);

    expect(res.status).toBe(200);
  });
});

describe('taking a sale (O5.7, O5.8)', () => {
  /**
   * The first thing in this app that creates an `Order`.
   *
   * ─── WHAT THESE TESTS PROTECT ────────────────────────────────────────
   * 1. ATOMICITY. Order, lines, stock movements and payment commit together.
   *    A sale that recorded the money but not the stock leaves books and
   *    shelves disagreeing with nothing to say which half happened — which is
   *    exactly what a dropped connection mid-payment produces.
   * 2. THE F1.1 SNAPSHOT RULE. `price` AND `cost` are captured at sale time.
   *    Margin reporting once joined `products.cost` live, so a supplier price
   *    change silently rewrote the profit on every past order; a checkout
   *    setting only `price` reintroduces exactly that.
   * 3. Missing cost stores NULL, never 0 — a fabricated zero reports the sale
   *    as pure profit.
   */

  async function stockAt(productId: string, quantity: number) {
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity },
      update: { quantity },
    });
    await prisma.product.update({ where: { id: productId }, data: { stock: quantity } });
  }

  function sell(
    body: Record<string, unknown>,
    token = ownerToken,
    idempotencyKey = randomUUID(),
  ) {
    return request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(token))
      .set('Idempotency-Key', idempotencyKey)
      .set('X-Branch-Id', branchId)
      .send(body);
  }

  it('requires an idempotency key before starting a sale', async () => {
    const res = await request(app)
      .post('/api/v1/pos/checkout')
      .set({ Authorization: `Bearer ${ownerToken}` })
      .set('X-Branch-Id', branchId)
      .send({ lines: [{ productId: 'not-reached', quantity: 1 }], method: 'cash' });

    expect(res.status).toBe(400);
    expect((res.body as { error: { details: { field: string } } }).error.details.field).toBe(
      'Idempotency-Key',
    );
  });

  it('creates the order, moves the stock and records the payment', async () => {
    const product = await makeProduct({ sku: `${RUN}-SELL-1`, price: '10.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 2 }],
      method: 'cash',
      tendered: '50.00',
    });

    expect(res.status).toBe(201);

    const body = res.body as {
      data: { orderId: string; total: string; change: string | null };
    };

    // 2 x 10.00, no tax configured in this suite.
    expect(body.data.total).toBe('20.00');
    // Change is STORED, not recomputed at read time.
    expect(body.data.change).toBe('30.00');

    const order = await prisma.order.findUnique({
      where: { id: body.data.orderId },
      select: {
        status: true,
        branchId: true,
        items: { select: { quantity: true, price: true, cost: true } },
        payments: { select: { amount: true, method: true, tendered: true, change: true } },
      },
    });

    expect(order?.status).toBe('CONFIRMED');
    expect(order?.branchId).toBe(branchId);
    expect(order?.items).toHaveLength(1);
    expect(order?.payments).toHaveLength(1);
    expect(order?.payments[0]?.amount.toFixed(2)).toBe('20.00');

    // Stock down at the branch AND on the product — the two numbers F8.2
    // keeps in agreement.
    const after = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId } },
    });
    expect(after?.quantity).toBe(3);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, reason: 'SOLD' },
      select: { delta: true, branchId: true },
    });
    expect(movement?.delta).toBe(-2);
    expect(movement?.branchId).toBe(branchId);
  });

  it('replays the original receipt without moving money or stock twice', async () => {
    const product = await makeProduct({ sku: `${RUN}-IDEM-1`, price: '10.00', stock: 5 });
    await stockAt(product.id, 5);
    const key = randomUUID();
    const body = {
      lines: [{ productId: product.id, quantity: 2 }],
      method: 'cash',
      tendered: '20.00',
    };

    const first = await sell(body, ownerToken, key);
    const replay = await sell(body, ownerToken, key);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBe('false');
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const orderId = (first.body as { data: { orderId: string } }).data.orderId;
    const [orders, payments, movements, stock] = await Promise.all([
      prisma.order.count({ where: { id: orderId } }),
      prisma.payment.count({ where: { orderId } }),
      prisma.stockMovement.count({ where: { productId: product.id, reason: 'SOLD' } }),
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
      }),
    ]);

    expect(orders).toBe(1);
    expect(payments).toBe(1);
    expect(movements).toBe(1);
    expect(stock?.quantity).toBe(3);
  });

  it('lets only one of two simultaneous cashiers take the last units', async () => {
    // DISTINCT idempotency keys on purpose — two different sales, not one
    // retried. A shared key would exercise the replay path (covered above)
    // and prove nothing about stock.
    const product = await makeProduct({ sku: `${RUN}-OVERSELL-RACE`, price: '9.00', stock: 2 });
    await stockAt(product.id, 2);

    const body = { lines: [{ productId: product.id, quantity: 2 }], method: 'cash' };

    const [left, right] = await Promise.all([sell(body), sell(body)]);

    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 400]);

    const refused = left.status === 400 ? left : right;
    expect(JSON.stringify(refused.body)).toMatch(/left at this branch/);

    // The shelf must never go negative, and exactly one sale may exist.
    const [stock, movements] = await Promise.all([
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
      }),
      prisma.stockMovement.count({ where: { productId: product.id, reason: 'SOLD' } }),
    ]);

    expect(stock?.quantity).toBe(0);
    expect(movements).toBe(1);
  });

  it('refuses a sale larger than the units on the shelf', async () => {
    const product = await makeProduct({ sku: `${RUN}-OVERSELL-ONE`, price: '4.00', stock: 1 });
    await stockAt(product.id, 1);

    const res = await sell({ lines: [{ productId: product.id, quantity: 3 }], method: 'cash' });

    expect(res.status).toBe(400);

    const stock = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId } },
    });
    expect(stock?.quantity).toBe(1);
  });

  it('serializes simultaneous submissions carrying the same key', async () => {
    const product = await makeProduct({ sku: `${RUN}-IDEM-RACE`, price: '7.00', stock: 5 });
    await stockAt(product.id, 5);
    const key = randomUUID();
    const body = {
      lines: [{ productId: product.id, quantity: 2 }],
      method: 'card',
      reference: `${RUN}-CARD-RACE`,
    };

    const [left, right] = await Promise.all([
      sell(body, ownerToken, key),
      sell(body, ownerToken, key),
    ]);

    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(left.body).toEqual(right.body);
    expect(
      [left.headers['idempotency-replayed'], right.headers['idempotency-replayed']].sort(),
    ).toEqual(['false', 'true']);

    const orderId = (left.body as { data: { orderId: string } }).data.orderId;
    const [payments, movements, stock] = await Promise.all([
      prisma.payment.count({ where: { orderId } }),
      prisma.stockMovement.count({ where: { productId: product.id, reason: 'SOLD' } }),
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
      }),
    ]);

    expect(payments).toBe(1);
    expect(movements).toBe(1);
    expect(stock?.quantity).toBe(3);
  });

  it('refuses reuse of a key for different sale details', async () => {
    const product = await makeProduct({ sku: `${RUN}-IDEM-2`, price: '5.00', stock: 5 });
    await stockAt(product.id, 5);
    const key = randomUUID();

    const first = await sell(
      { lines: [{ productId: product.id, quantity: 1 }], method: 'cash' },
      ownerToken,
      key,
    );
    const mismatch = await sell(
      { lines: [{ productId: product.id, quantity: 2 }], method: 'cash' },
      ownerToken,
      key,
    );

    expect(first.status).toBe(201);
    expect(mismatch.status).toBe(409);
    expect((mismatch.body as { error: { code: string } }).error.code).toBe('CONFLICT');

    const stock = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId } },
    });
    expect(stock?.quantity).toBe(4);
  });

  it('snapshots BOTH price and cost at sale time (F1.1)', async () => {
    const product = await makeProduct({ sku: `${RUN}-SELL-2`, price: '8.00', stock: 10 });
    await prisma.product.update({
      where: { id: product.id },
      data: { cost: new Prisma.Decimal('3.00') },
    });
    await stockAt(product.id, 10);

    const res = await sell({ lines: [{ productId: product.id, quantity: 1 }], method: 'card' });
    const orderId = (res.body as { data: { orderId: string } }).data.orderId;

    // The supplier puts their price up AFTER the sale.
    await prisma.product.update({
      where: { id: product.id },
      data: { cost: new Prisma.Decimal('7.50'), price: new Prisma.Decimal('20.00') },
    });

    const item = await prisma.orderItem.findFirst({
      where: { orderId },
      select: { price: true, cost: true },
    });

    // Both frozen at what they were. This is the bug OrderItem.cost exists to
    // prevent: a live join would now report the sale at 0.50 profit instead
    // of 5.00, rewriting history.
    expect(item?.price.toFixed(2)).toBe('8.00');
    expect(item?.cost?.toFixed(2)).toBe('3.00');
  });

  it('stores NULL cost when the product has none — never 0', async () => {
    // "Not recorded" is a real, permanent state. A fabricated zero would
    // report the whole sale as pure profit.
    const product = await makeProduct({ sku: `${RUN}-SELL-3`, price: '6.00', stock: 4 });
    await stockAt(product.id, 4);

    const res = await sell({ lines: [{ productId: product.id, quantity: 1 }], method: 'cash' });
    const orderId = (res.body as { data: { orderId: string } }).data.orderId;

    const item = await prisma.orderItem.findFirst({ where: { orderId }, select: { cost: true } });

    expect(item?.cost).toBeNull();
  });

  it('refuses a sale that would take branch stock negative (O5.8)', async () => {
    const product = await makeProduct({ sku: `${RUN}-SELL-4`, price: '5.00', stock: 2 });
    await stockAt(product.id, 2);

    const res = await sell({ lines: [{ productId: product.id, quantity: 3 }], method: 'cash' });

    expect(res.status).toBe(400);
    // Names the number, so the cashier can check the shelf against it.
    expect((res.body as { error: { message: string } }).error.message).toMatch(/Only 2/);
  });

  it('writes NOTHING when a line is refused — atomicity', async () => {
    // The rule that matters. A partially applied sale is a shop whose books
    // and shelves disagree.
    const ok = await makeProduct({ sku: `${RUN}-SELL-5`, price: '5.00', stock: 10 });
    const short = await makeProduct({ sku: `${RUN}-SELL-6`, price: '5.00', stock: 1 });
    await stockAt(ok.id, 10);
    await stockAt(short.id, 1);

    const before = await prisma.order.count();

    const res = await sell({
      lines: [
        { productId: ok.id, quantity: 2 },
        { productId: short.id, quantity: 5 },
      ],
      method: 'cash',
    });

    expect(res.status).toBe(400);

    // No order, and the GOOD line's stock is untouched.
    expect(await prisma.order.count()).toBe(before);

    const okStock = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: ok.id, branchId } },
    });
    expect(okStock?.quantity).toBe(10);
  });

  it('allows an oversell when the setting says so', async () => {
    // A shop mid-stocktake must not have its till stop working over
    // bookkeeping — hence the escape hatch, and hence its default being off.
    const product = await makeProduct({ sku: `${RUN}-SELL-7`, price: '5.00', stock: 1 });
    await stockAt(product.id, 1);

    await prisma.setting.upsert({
      where: { key: 'inventory.allowNegativeStock' },
      create: { key: 'inventory.allowNegativeStock', value: true },
      update: { value: true },
    });

    try {
      const res = await sell({ lines: [{ productId: product.id, quantity: 3 }], method: 'cash' });

      expect(res.status).toBe(201);

      const after = await prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
      });
      // Negative, and visible as such — the discrepancy is recorded rather
      // than clamped to zero, which would hide it.
      expect(after?.quantity).toBe(-2);
    } finally {
      await prisma.setting.deleteMany({ where: { key: 'inventory.allowNegativeStock' } });
    }
  });

  /**
   * Paying in a currency other than the store's own.
   *
   * The property that matters is which column holds which currency:
   * `amount` stays in the STORE currency so every revenue, shift and report
   * query keeps summing one comparable unit, while `tenderAmount`/`change`
   * are in what the customer actually handed over — because change is given
   * in the tendered currency and the drawer is counted per currency at close.
   */
  it('records a foreign-currency sale in both currencies, with the rate snapshotted', async () => {
    const product = await makeProduct({ sku: `${RUN}-FX-1`, price: '100.00', stock: 5 });
    await stockAt(product.id, 5);

    // Store sells in AED; USD accepted at 0.25 per 1 AED. A 100 AED sale is
    // therefore 25 USD, and 30 USD tendered owes 5 USD change.
    await prisma.setting.upsert({
      where: { key: 'pos.tenderRate.USD' },
      create: { key: 'pos.tenderRate.USD', value: 0.25 },
      update: { value: 0.25 },
    });

    try {
      const res = await sell({
        lines: [{ productId: product.id, quantity: 1 }],
        method: 'cash',
        tenderCurrency: 'USD',
        tendered: '30.00',
      });

      expect(res.status).toBe(201);

      const payment = await prisma.payment.findFirstOrThrow({
        where: { orderId: (res.body as { data: { orderId: string } }).data.orderId },
      });

      // Base currency — what the books and every report read.
      expect(payment.amount.toFixed(2)).toBe('100.00');
      // Tendered currency — what was physically on the counter.
      expect(payment.tenderCurrency).toBe('USD');
      expect(payment.tenderAmount?.toFixed(2)).toBe('25.00');
      expect(payment.change?.toFixed(2)).toBe('5.00');
      // Snapshotted, so editing the setting later cannot rewrite this receipt.
      expect(payment.tenderRate?.toString()).toBe('0.25');
    } finally {
      await prisma.setting.deleteMany({ where: { key: 'pos.tenderRate.USD' } });
    }
  });

  it('refuses a currency with no configured rate, rather than charging in the base', async () => {
    // A silent fallback would record a sale in AED that the customer paid in
    // USD, and nothing downstream could ever detect it.
    const product = await makeProduct({ sku: `${RUN}-FX-2`, price: '10.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tenderCurrency: 'GBP',
      tendered: '50.00',
    });

    expect(res.status).toBe(400);
  });

  it('leaves the tender columns null for a sale in the store currency', async () => {
    // The ordinary case must stay indistinguishable from a pre-migration row.
    const product = await makeProduct({ sku: `${RUN}-FX-3`, price: '10.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tendered: '20.00',
    });

    expect(res.status).toBe(201);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: (res.body as { data: { orderId: string } }).data.orderId },
    });

    expect(payment.tenderCurrency).toBeNull();
    expect(payment.tenderAmount).toBeNull();
    expect(payment.tenderRate).toBeNull();
  });

  it('refuses tendered less than the total', async () => {
    const product = await makeProduct({ sku: `${RUN}-SELL-8`, price: '30.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tendered: '20.00',
    });

    expect(res.status).toBe(400);
  });

  it('leaves tendered and change NULL on a card sale', async () => {
    // Nothing was handed over and nothing came back. Null means "not
    // applicable", never zero.
    const product = await makeProduct({ sku: `${RUN}-SELL-9`, price: '12.00', stock: 3 });
    await stockAt(product.id, 3);

    const res = await sell({ lines: [{ productId: product.id, quantity: 1 }], method: 'card' });
    const orderId = (res.body as { data: { orderId: string } }).data.orderId;

    const payment = await prisma.payment.findFirst({
      where: { orderId },
      select: { tendered: true, change: true },
    });

    expect(payment?.tendered).toBeNull();
    expect(payment?.change).toBeNull();
  });

  it('refuses the same product on two lines', async () => {
    // Each line would decrement stock separately and print twice on the
    // receipt. The cart merges them; this refuses rather than silently
    // summing — the same call bulk receive makes.
    const product = await makeProduct({ sku: `${RUN}-SELL-10`, price: '5.00', stock: 10 });
    await stockAt(product.id, 10);

    const res = await sell({
      lines: [
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 1 },
      ],
      method: 'cash',
    });

    expect(res.status).toBe(400);
  });

  /**
   * Whose drawer a sale belongs to (O9.17).
   *
   * ─── WHAT THIS REPLACED ──────────────────────────────────────────
   * The previous version of this test opened a shift for a CASHIER, then
   * sold as the OWNER while passing the cashier's `shiftId` in the body —
   * and asserted the payment landed on that shift. It passed, and it was
   * asserting the bug: the id was taken from the request and written
   * unverified, so one person's sale could be credited to another person's
   * drawer. `closeTill` then computed a variance against a figure that was
   * never theirs.
   *
   * The id now comes from the token, so these tests sell as the person whose
   * shift it is and prove the body cannot override it.
   */
  async function openShiftFor(userId: string) {
    const shift = await prisma.shift.create({
      data: {
        userId,
        branchId,
        openedById: userId,
        startedAt: new Date(),
        openingFloat: new Prisma.Decimal('0.00'),
      },
      select: { id: true },
    });
    shiftIds.push(shift.id);
    return shift;
  }

  async function paymentShiftFor(res: request.Response) {
    const payment = await prisma.payment.findFirst({
      where: { orderId: (res.body as { data: { orderId: string } }).data.orderId },
      select: { shiftId: true },
    });
    return payment?.shiftId ?? null;
  }

  it('links the sale to the seller own open till session', async () => {
    const owner = await prisma.user.findFirst({
      where: { email: `${RUN}-owner@example.test` },
      select: { id: true },
    });
    const shift = await openShiftFor(owner!.id);

    const product = await makeProduct({ sku: `${RUN}-SELL-11`, price: '15.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tendered: '15.00',
    });

    expect(res.status).toBe(201);
    // Attached without the client naming it — that is the whole point.
    expect(await paymentShiftFor(res)).toBe(shift.id);

    await prisma.shift.update({
      where: { id: shift.id },
      data: { endedAt: new Date() },
    });
  });

  it('ignores a shiftId in the body — it cannot credit another drawer', async () => {
    // Somebody else's open drawer. Before the fix, naming it here moved this
    // sale's cash into their count.
    const cashier = await makeUser(StaffRole.SUPPORT, 'pos-other-cashier');
    const theirs = await openShiftFor(cashier.id);

    const product = await makeProduct({ sku: `${RUN}-SELL-12`, price: '15.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tendered: '15.00',
      shiftId: theirs.id,
    });

    expect(res.status).toBe(201);
    // The seller (owner) has no open shift, so this belongs to no drawer —
    // and emphatically not to the cashier's.
    expect(await paymentShiftFor(res)).not.toBe(theirs.id);
    expect(await paymentShiftFor(res)).toBeNull();
  });

  it('sells fine with no open shift at all', async () => {
    // An owner ringing up a sale outside any session is real. The payment
    // simply belongs to no drawer; it is not an error.
    const product = await makeProduct({ sku: `${RUN}-SELL-13`, price: '9.00', stock: 3 });
    await stockAt(product.id, 3);

    const res = await sell({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tendered: '9.00',
    });

    expect(res.status).toBe(201);
    expect(await paymentShiftFor(res)).toBeNull();
  });
});

describe('browsing the grid (O9.10)', () => {
  it('finds a product by a partial name match', async () => {
    const product = await makeProduct({ name: `${RUN} Flat White Grid` });

    const res = await browse({ q: `${RUN} Flat White` });

    expect(res.status).toBe(200);
    const body = res.body as { data: { products: { id: string }[] } };
    expect(body.data.products.some((p) => p.id === product.id)).toBe(true);
  });

  it('excludes archived products — a browse is choosing what to sell', async () => {
    // Unlike a scan, which must still surface an archived product physically
    // scanned off a shelf, browsing offers what CAN be sold.
    const archived = await makeProduct({
      name: `${RUN} Archived Grid Item`,
      status: ProductStatus.ARCHIVED,
    });

    const res = await browse({ q: `${RUN} Archived Grid` });

    const body = res.body as { data: { products: { id: string }[] } };
    expect(body.data.products.some((p) => p.id === archived.id)).toBe(false);
  });

  it('filters by category', async () => {
    const category = await makeCategory(`${RUN} Pastries`);
    const inCategory = await makeProduct({
      name: `${RUN} Croissant Grid`,
      categoryId: category.id,
    });
    const outsideCategory = await makeProduct({ name: `${RUN} Coffee Grid` });

    const res = await browse({ categoryId: category.id });

    const body = res.body as { data: { products: { id: string }[] } };
    const ids = body.data.products.map((p) => p.id);
    expect(ids).toContain(inCategory.id);
    expect(ids).not.toContain(outsideCategory.id);
  });

  it('filters by an explicit id list, for resuming a parked cart (O9.12b)', async () => {
    const wanted = await makeProduct({ name: `${RUN} Parked Resume Grid A` });
    const other = await makeProduct({ name: `${RUN} Parked Resume Grid B` });

    const res = await browse({ ids: wanted.id });

    const body = res.body as { data: { products: { id: string }[] } };
    const ids = body.data.products.map((p) => p.id);
    expect(ids).toContain(wanted.id);
    expect(ids).not.toContain(other.id);
  });

  it('reports branch stock the same way a scan does', async () => {
    const product = await makeProduct({ name: `${RUN} Stocked Grid Item`, stock: 10 });
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId: product.id, branchId } },
      create: { productId: product.id, branchId, quantity: 7 },
      update: { quantity: 7 },
    });

    const res = await browse({ q: `${RUN} Stocked Grid` }, ownerToken, branchId);

    const body = res.body as { data: { products: { id: string; branchStock: number | null }[] } };
    const row = body.data.products.find((p) => p.id === product.id);
    expect(row?.branchStock).toBe(7);
  });

  it('reports a missing branch row as 0, same as scanProduct', async () => {
    const product = await makeProduct({ name: `${RUN} No Branch Row Grid`, stock: 5 });

    const res = await browse({ q: `${RUN} No Branch Row Grid` }, ownerToken, branchId);

    const body = res.body as { data: { products: { id: string; branchStock: number | null }[] } };
    const row = body.data.products.find((p) => p.id === product.id);
    expect(row?.branchStock).toBe(0);
  });

  it('reports null stock when no branch is in context', async () => {
    const product = await makeProduct({ name: `${RUN} No Branch Header Grid` });

    const res = await browse({ q: `${RUN} No Branch Header Grid` });

    const body = res.body as { data: { products: { id: string; branchStock: number | null }[] } };
    const row = body.data.products.find((p) => p.id === product.id);
    expect(row?.branchStock).toBeNull();
  });

  it('lists active categories for the grid tabs', async () => {
    const active = await makeCategory(`${RUN} Active Tab`);
    const inactive = await prisma.category.create({
      data: {
        name: `${RUN} Inactive Tab`,
        slug: `${RUN}-inactive-tab`,
        isActive: false,
      },
    });
    categoryIds.push(inactive.id);

    const res = await browseCategoriesReq();

    expect(res.status).toBe(200);
    const body = res.body as { data: { categories: { id: string }[] } };
    const ids = body.data.categories.map((c) => c.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('is reachable by the CASHIER role, same as scan and checkout', async () => {
    // The owner confirmed the cashier's job is scanning and counting only —
    // this endpoint has to be part of that job, gated the same way scan is.
    const product = await makeProduct({ name: `${RUN} Cashier Grid Access` });

    const res = await browse({ q: `${RUN} Cashier Grid Access` }, supportToken);

    expect(res.status).toBe(200);
    const body = res.body as { data: { products: { id: string }[] } };
    expect(body.data.products.some((p) => p.id === product.id)).toBe(true);
  });
});

describe('discounts at the till (O9 Tier 3)', () => {
  // `branchId` (not a local copy) — a `describe` body runs synchronously at
  // collection time, before `beforeAll` has set the real value, so a copy
  // taken here would freeze the empty string it started as.
  function sellWithDiscount(body: Record<string, unknown>, token = ownerToken) {
    return request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(token))
      .set('X-Branch-Id', branchId)
      .send(body);
  }

  async function stockAt(productId: string, quantity: number) {
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity },
      update: { quantity },
    });
    await prisma.product.update({ where: { id: productId }, data: { stock: quantity } });
  }

  async function withCap(percent: number, run: () => Promise<void>) {
    await prisma.setting.upsert({
      where: { key: 'pos.maxCashierDiscountPercent' },
      create: { key: 'pos.maxCashierDiscountPercent', value: percent },
      update: { value: percent },
    });

    try {
      await run();
    } finally {
      await prisma.setting.deleteMany({ where: { key: 'pos.maxCashierDiscountPercent' } });
    }
  }

  it('reduces the charged total but keeps the recorded price the true one', async () => {
    await withCap(50, async () => {
      const product = await makeProduct({ sku: `${RUN}-DISC-1`, price: '10.00', stock: 5 });
      await stockAt(product.id, 5);

      const res = await sellWithDiscount({
        lines: [{ productId: product.id, quantity: 2, discountPercent: 10 }],
        method: 'cash',
        tendered: '18.00',
      });

      expect(res.status).toBe(201);
      const body = res.body as { data: { orderId: string; subtotal: string; total: string } };
      // 2 x 10.00 at 10% off = 18.00, not 20.00.
      expect(body.data.subtotal).toBe('18.00');

      const item = await prisma.orderItem.findFirst({
        where: { orderId: body.data.orderId },
      });
      // The SNAPSHOT stays the real product price — never the discounted
      // figure. Reading it as anything else would silently rewrite margin
      // and revenue reporting.
      expect(item?.price.toFixed(2)).toBe('10.00');
      expect(item?.discountPercent?.toFixed(2)).toBe('10.00');
    });
  });

  it('records no discount on a line that asked for none', async () => {
    const product = await makeProduct({ sku: `${RUN}-DISC-2`, price: '5.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellWithDiscount({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      tendered: '5.00',
    });

    const body = res.body as { data: { orderId: string } };
    const item = await prisma.orderItem.findFirst({ where: { orderId: body.data.orderId } });

    // NULL, never 0 — "no discount control ever touched this line" is a
    // different fact from "a discount of exactly zero was applied".
    expect(item?.discountPercent).toBeNull();
  });

  it('refuses a discount above the cap with no override token', async () => {
    await withCap(10, async () => {
      const product = await makeProduct({ sku: `${RUN}-DISC-3`, price: '10.00', stock: 5 });
      await stockAt(product.id, 5);

      const res = await sellWithDiscount({
        lines: [{ productId: product.id, quantity: 1, discountPercent: 30 }],
        method: 'cash',
      });

      expect(res.status).toBe(403);

      // Refused before anything moved.
      const movements = await prisma.stockMovement.count({ where: { productId: product.id } });
      expect(movements).toBe(0);
    });
  });

  it('refuses a discount above the cap with a garbage override token', async () => {
    await withCap(10, async () => {
      const product = await makeProduct({ sku: `${RUN}-DISC-4`, price: '10.00', stock: 5 });
      await stockAt(product.id, 5);

      const res = await sellWithDiscount({
        lines: [{ productId: product.id, quantity: 1, discountPercent: 30 }],
        method: 'cash',
        overrideToken: 'not-a-real-token',
      });

      expect(res.status).toBe(403);
    });
  });

  it('approves a discount above the cap with a real manager override token', async () => {
    await withCap(10, async () => {
      const manager = await makeUser(StaffRole.MANAGER, 'discount-manager');
      const approval = await verifyManagerOverride(
        manager.email,
        'correct-horse-battery-staple',
      );

      const product = await makeProduct({ sku: `${RUN}-DISC-5`, price: '10.00', stock: 5 });
      await stockAt(product.id, 5);

      const res = await sellWithDiscount({
        lines: [{ productId: product.id, quantity: 1, discountPercent: 30 }],
        method: 'cash',
        overrideToken: approval.overrideToken,
      });

      expect(res.status).toBe(201);
      const body = res.body as { data: { subtotal: string } };
      expect(body.data.subtotal).toBe('7.00');
    });
  });

  it('does not need an override for a discount at or below the cap', async () => {
    await withCap(20, async () => {
      const product = await makeProduct({ sku: `${RUN}-DISC-6`, price: '10.00', stock: 5 });
      await stockAt(product.id, 5);

      const res = await sellWithDiscount({
        lines: [{ productId: product.id, quantity: 1, discountPercent: 20 }],
        method: 'cash',
      });

      expect(res.status).toBe(201);
    });
  });

  it('refuses a discount outside 0-100 before touching the database', async () => {
    const product = await makeProduct({ sku: `${RUN}-DISC-7`, price: '10.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellWithDiscount({
      lines: [{ productId: product.id, quantity: 1, discountPercent: 150 }],
      method: 'cash',
    });

    expect(res.status).toBe(400);
  });
});

describe('voiding a sale at the till (O9 Tier 3)', () => {
  function voidSaleAs(orderId: string, body: Record<string, unknown> = {}, token = ownerToken) {
    return request(app)
      .post(`/api/v1/pos/orders/${orderId}/void`)
      .set(auth(token))
      .set('X-Branch-Id', branchId)
      .send(body);
  }

  async function stockAt(productId: string, quantity: number) {
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity },
      update: { quantity },
    });
    await prisma.product.update({ where: { id: productId }, data: { stock: quantity } });
  }

  it('gives the stock back and reverses the payment', async () => {
    const product = await makeProduct({ sku: `${RUN}-VOID-1`, price: '10.00', stock: 5 });
    await stockAt(product.id, 5);

    const sale = await request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId)
      .send({ lines: [{ productId: product.id, quantity: 2 }], method: 'cash', tendered: '20.00' });

    const orderId = (sale.body as { data: { orderId: string } }).data.orderId;

    const res = await voidSaleAs(orderId);

    expect(res.status).toBe(200);

    const [branchStock, product2, order, payments] = await Promise.all([
      prisma.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId } },
      }),
      prisma.product.findUnique({ where: { id: product.id } }),
      prisma.order.findUnique({ where: { id: orderId } }),
      prisma.payment.findMany({ where: { orderId } }),
    ]);

    // Back to 5 — the 2 sold were given back.
    expect(branchStock?.quantity).toBe(5);
    expect(product2?.stock).toBe(5);
    expect(order?.status).toBe('CANCELED');

    // Two payment rows now: the original +20.00 and a reversal -20.00.
    expect(payments).toHaveLength(2);
    const total = payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    expect(total.toFixed(2)).toBe('0.00');
  });

  it('records a stock movement explaining the void', async () => {
    const product = await makeProduct({ sku: `${RUN}-VOID-2`, price: '5.00', stock: 3 });
    await stockAt(product.id, 3);

    const sale = await request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId)
      .send({ lines: [{ productId: product.id, quantity: 1 }], method: 'cash', tendered: '5.00' });

    const orderId = (sale.body as { data: { orderId: string } }).data.orderId;
    await voidSaleAs(orderId);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, reason: 'CORRECTION' },
    });

    expect(movement).not.toBeNull();
    expect(movement?.delta).toBe(1);
  });

  it('refuses to void an order that already moved on', async () => {
    const product = await makeProduct({ sku: `${RUN}-VOID-3`, price: '5.00', stock: 3 });
    await stockAt(product.id, 3);

    const sale = await request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId)
      .send({ lines: [{ productId: product.id, quantity: 1 }], method: 'cash', tendered: '5.00' });

    const orderId = (sale.body as { data: { orderId: string } }).data.orderId;
    await prisma.order.update({ where: { id: orderId }, data: { status: 'DELIVERED' } });

    const res = await voidSaleAs(orderId);

    expect(res.status).toBe(400);

    // Refused before anything moved — stock stays as the (already reduced)
    // sale left it.
    const branchStock = await prisma.branchStock.findUnique({
      where: { productId_branchId: { productId: product.id, branchId } },
    });
    expect(branchStock?.quantity).toBe(2);
  });

  it('refuses a cashier voiding with no manager override', async () => {
    const cashier = await makeUser(StaffRole.CASHIER, 'void-cashier-1');
    const product = await makeProduct({ sku: `${RUN}-VOID-4`, price: '5.00', stock: 3 });
    await stockAt(product.id, 3);

    const sale = await request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId)
      .send({ lines: [{ productId: product.id, quantity: 1 }], method: 'cash', tendered: '5.00' });

    const orderId = (sale.body as { data: { orderId: string } }).data.orderId;

    const res = await voidSaleAs(orderId, {}, signToken(cashier));

    expect(res.status).toBe(403);
  });

  it('approves once a real manager override token verifies', async () => {
    const cashier = await makeUser(StaffRole.CASHIER, 'void-cashier-2');
    const manager = await makeUser(StaffRole.MANAGER, 'void-manager-1');
    const approval = await verifyManagerOverride(
      manager.email,
      'correct-horse-battery-staple',
    );

    const product = await makeProduct({ sku: `${RUN}-VOID-5`, price: '5.00', stock: 3 });
    await stockAt(product.id, 3);

    const sale = await request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(ownerToken))
      .set('X-Branch-Id', branchId)
      .send({ lines: [{ productId: product.id, quantity: 1 }], method: 'cash', tendered: '5.00' });

    const orderId = (sale.body as { data: { orderId: string } }).data.orderId;

    const res = await voidSaleAs(
      orderId,
      { overrideToken: approval.overrideToken },
      signToken(cashier),
    );

    expect(res.status).toBe(200);
  });
});

describe('split payment (O9 Tier 3)', () => {
  function sellSplit(body: Record<string, unknown>, token = ownerToken) {
    return request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(token))
      .set('X-Branch-Id', branchId)
      .send(body);
  }

  async function stockAt(productId: string, quantity: number) {
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity },
      update: { quantity },
    });
    await prisma.product.update({ where: { id: productId }, data: { stock: quantity } });
  }

  it('writes one Payment row per entry', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-1`, price: '20.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      splitPayments: [
        { method: 'cash', amount: '10.00' },
        { method: 'card', amount: '10.00' },
      ],
    });

    expect(res.status).toBe(201);

    const payments = await prisma.payment.findMany({
      where: { orderId: (res.body as { data: { orderId: string } }).data.orderId },
      orderBy: { method: 'asc' },
    });

    expect(payments).toHaveLength(2);
    expect(payments.map((p) => p.amount.toFixed(2)).sort()).toEqual(['10.00', '10.00']);
    expect(payments.map((p) => p.method).sort()).toEqual(['card', 'cash']);
  });

  it('records the order paymentMethod as "split"', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-2`, price: '20.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      splitPayments: [
        { method: 'cash', amount: '10.00' },
        { method: 'card', amount: '10.00' },
      ],
    });

    const order = await prisma.order.findUnique({
      where: { id: (res.body as { data: { orderId: string } }).data.orderId },
    });

    expect(order?.paymentMethod).toBe('split');
  });

  it('refuses when the split does not sum to the total', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-3`, price: '20.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      splitPayments: [
        { method: 'cash', amount: '5.00' },
        { method: 'card', amount: '5.00' },
      ],
    });

    expect(res.status).toBe(400);

    // Nothing written — no stock movement for a refused sale.
    const movements = await prisma.stockMovement.count({ where: { productId: product.id } });
    expect(movements).toBe(0);
  });

  it('refuses a single-entry split — not what the shape is for', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-4`, price: '20.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      splitPayments: [{ method: 'cash', amount: '20.00' }],
    });

    expect(res.status).toBe(400);
  });

  it('refuses sending both method and splitPayments', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-5`, price: '20.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      method: 'cash',
      splitPayments: [
        { method: 'cash', amount: '10.00' },
        { method: 'card', amount: '10.00' },
      ],
    });

    expect(res.status).toBe(400);
  });

  it('computes change on the cash leg only', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-6`, price: '15.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      splitPayments: [
        { method: 'cash', amount: '10.00', tendered: '15.00' },
        { method: 'card', amount: '5.00' },
      ],
    });

    expect(res.status).toBe(201);
    // 15.00 tendered against a 10.00 cash leg = 5.00 change.
    expect((res.body as { data: { change: string | null } }).data.change).toBe('5.00');
  });

  it('refuses tendered less than a cash leg amount', async () => {
    const product = await makeProduct({ sku: `${RUN}-SPLIT-7`, price: '15.00', stock: 5 });
    await stockAt(product.id, 5);

    const res = await sellSplit({
      lines: [{ productId: product.id, quantity: 1 }],
      splitPayments: [
        { method: 'cash', amount: '10.00', tendered: '5.00' },
        { method: 'card', amount: '5.00' },
      ],
    });

    expect(res.status).toBe(400);
  });
});

describe('park / resume a sale (O9.12b)', () => {
  function park(body: Record<string, unknown>, token = ownerToken) {
    return request(app)
      .post('/api/v1/pos/parked')
      .set(auth(token))
      .set('X-Branch-Id', branchId)
      .send(body);
  }

  function listParked(token = ownerToken) {
    return request(app).get('/api/v1/pos/parked').set(auth(token)).set('X-Branch-Id', branchId);
  }

  function resume(id: string, token = ownerToken) {
    return request(app)
      .post(`/api/v1/pos/parked/${id}/resume`)
      .set(auth(token))
      .set('X-Branch-Id', branchId);
  }

  function discard(id: string, token = ownerToken) {
    return request(app)
      .delete(`/api/v1/pos/parked/${id}`)
      .set(auth(token))
      .set('X-Branch-Id', branchId);
  }

  it('parks a cart and lists it back', async () => {
    const product = await makeProduct({ sku: `${RUN}-PARK-1`, price: '9.00' });

    const res = await park({
      lines: [{ productId: product.id, quantity: 2 }],
      label: 'Sara — red jacket',
    });

    expect(res.status).toBe(201);
    const body = res.body as { data: { id: string; label: string | null } };
    expect(body.data.label).toBe('Sara — red jacket');

    const list = await listParked();
    const ids = (list.body as { data: { id: string }[] }).data.map((row) => row.id);
    expect(ids).toContain(body.data.id);
  });

  it('refuses parking an empty cart', async () => {
    const res = await park({ lines: [] });
    expect(res.status).toBe(400);
  });

  it('resuming returns the cart and removes it from the list', async () => {
    const product = await makeProduct({ sku: `${RUN}-PARK-2`, price: '9.00' });

    const parked = await park({ lines: [{ productId: product.id, quantity: 1 }] });
    const id = (parked.body as { data: { id: string } }).data.id;

    const res = await resume(id);

    expect(res.status).toBe(200);
    const body = res.body as { data: { lines: { productId: string; quantity: number }[] } };
    expect(body.data.lines).toEqual([{ productId: product.id, quantity: 1 }]);

    const list = await listParked();
    const ids = (list.body as { data: { id: string }[] }).data.map((row) => row.id);
    expect(ids).not.toContain(id);
  });

  it('discarding removes it without returning it to the register', async () => {
    const product = await makeProduct({ sku: `${RUN}-PARK-3`, price: '9.00' });

    const parked = await park({ lines: [{ productId: product.id, quantity: 1 }] });
    const id = (parked.body as { data: { id: string } }).data.id;

    const res = await discard(id);
    expect(res.status).toBe(204);

    const list = await listParked();
    const ids = (list.body as { data: { id: string }[] }).data.map((row) => row.id);
    expect(ids).not.toContain(id);
  });

  it('refuses resuming a cart parked by somebody else', async () => {
    const other = await makeUser(StaffRole.SUPPORT, 'park-other-1');
    const product = await makeProduct({ sku: `${RUN}-PARK-4`, price: '9.00' });

    const parked = await park({ lines: [{ productId: product.id, quantity: 1 }] }, ownerToken);
    const id = (parked.body as { data: { id: string } }).data.id;

    const res = await resume(id, signToken(other));
    expect(res.status).toBe(403);

    // Still there — the refused attempt did not remove it.
    const stillParked = await prisma.parkedSale.findUnique({ where: { id } });
    expect(stillParked).not.toBeNull();
  });

  it('refuses discarding a cart parked by somebody else', async () => {
    const other = await makeUser(StaffRole.SUPPORT, 'park-other-2');
    const product = await makeProduct({ sku: `${RUN}-PARK-5`, price: '9.00' });

    const parked = await park({ lines: [{ productId: product.id, quantity: 1 }] }, ownerToken);
    const id = (parked.body as { data: { id: string } }).data.id;

    const res = await discard(id, signToken(other));
    expect(res.status).toBe(403);
  });
});

describe('exchange (O9.8)', () => {
  function sell(body: Record<string, unknown>, token = ownerToken) {
    return request(app)
      .post('/api/v1/pos/checkout')
      .set(auth(token))
      .set('X-Branch-Id', branchId)
      .send(body);
  }

  async function stockAt(productId: string, quantity: number) {
    await prisma.branchStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, quantity },
      update: { quantity },
    });
    await prisma.product.update({ where: { id: productId }, data: { stock: quantity } });
  }

  /** Seeds a return in the state an exchange links against — REPLACEMENT
   *  resolution, not yet linked to a sale. Created directly via Prisma
   *  rather than the full request/approve HTTP flow, which is already
   *  covered by `returns.test.ts`; this only needs a return in the right
   *  shape, not to re-prove approval works. */
  let rmaCounter = 0;

  async function seedReplacementReturn(orderId: string, orderItemId: string) {
    rmaCounter += 1;
    return prisma.return.create({
      data: {
        rmaNumber: `RMA-${RUN.slice(-6).toUpperCase()}${String(rmaCounter).padStart(2, '0')}`,
        reason: 'Wrong size',
        status: 'APPROVED',
        resolution: ReturnResolution.REPLACEMENT,
        orderId,
        items: { create: [{ orderItemId, quantity: 1 }] },
      },
    });
  }

  it('links the return to the replacement sale', async () => {
    const original = await makeProduct({ sku: `${RUN}-EXCH-1`, price: '10.00', stock: 5 });
    await stockAt(original.id, 5);

    const originalSale = await sell({
      lines: [{ productId: original.id, quantity: 1 }],
      method: 'cash',
      tendered: '10.00',
    });
    const orderId = (originalSale.body as { data: { orderId: string } }).data.orderId;
    const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });

    const ret = await seedReplacementReturn(orderId, orderItem.id);

    const replacement = await makeProduct({ sku: `${RUN}-EXCH-2`, price: '12.00', stock: 5 });
    await stockAt(replacement.id, 5);

    const res = await sell({
      lines: [{ productId: replacement.id, quantity: 1 }],
      method: 'cash',
      tendered: '12.00',
      exchangeReturnId: ret.id,
    });

    expect(res.status).toBe(201);

    const linked = await prisma.return.findUnique({ where: { id: ret.id } });
    expect(linked?.exchangeOrderId).toBe(
      (res.body as { data: { orderId: string } }).data.orderId,
    );
  });

  it('refuses linking a return that was not resolved as a replacement', async () => {
    const original = await makeProduct({ sku: `${RUN}-EXCH-3`, price: '10.00', stock: 5 });
    await stockAt(original.id, 5);

    const originalSale = await sell({
      lines: [{ productId: original.id, quantity: 1 }],
      method: 'cash',
      tendered: '10.00',
    });
    const orderId = (originalSale.body as { data: { orderId: string } }).data.orderId;
    const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });

    const ret = await prisma.return.create({
      data: {
        rmaNumber: `RMA-${RUN.slice(-7).toUpperCase()}A`,
        reason: 'Changed mind',
        status: 'APPROVED',
        resolution: ReturnResolution.REFUND,
        orderId,
        items: { create: [{ orderItemId: orderItem.id, quantity: 1 }] },
      },
    });

    const replacement = await makeProduct({ sku: `${RUN}-EXCH-4`, price: '12.00', stock: 5 });
    await stockAt(replacement.id, 5);

    const res = await sell({
      lines: [{ productId: replacement.id, quantity: 1 }],
      method: 'cash',
      tendered: '12.00',
      exchangeReturnId: ret.id,
    });

    expect(res.status).toBe(400);
  });

  it('refuses linking a return that already has a replacement sale', async () => {
    const original = await makeProduct({ sku: `${RUN}-EXCH-5`, price: '10.00', stock: 5 });
    await stockAt(original.id, 5);

    const originalSale = await sell({
      lines: [{ productId: original.id, quantity: 1 }],
      method: 'cash',
      tendered: '10.00',
    });
    const orderId = (originalSale.body as { data: { orderId: string } }).data.orderId;
    const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });

    const ret = await seedReplacementReturn(orderId, orderItem.id);

    const firstReplacement = await makeProduct({ sku: `${RUN}-EXCH-6`, price: '12.00', stock: 5 });
    await stockAt(firstReplacement.id, 5);

    const first = await sell({
      lines: [{ productId: firstReplacement.id, quantity: 1 }],
      method: 'cash',
      tendered: '12.00',
      exchangeReturnId: ret.id,
    });
    expect(first.status).toBe(201);

    const secondReplacement = await makeProduct({ sku: `${RUN}-EXCH-7`, price: '9.00', stock: 5 });
    await stockAt(secondReplacement.id, 5);

    const second = await sell({
      lines: [{ productId: secondReplacement.id, quantity: 1 }],
      method: 'cash',
      tendered: '9.00',
      exchangeReturnId: ret.id,
    });

    expect(second.status).toBe(400);

    // The FIRST sale's link survived — a refused second attempt must not
    // steal or clear it.
    const linked = await prisma.return.findUnique({ where: { id: ret.id } });
    expect(linked?.exchangeOrderId).toBe(
      (first.body as { data: { orderId: string } }).data.orderId,
    );
  });

  it('refuses linking a return that does not exist', async () => {
    const replacement = await makeProduct({ sku: `${RUN}-EXCH-8`, price: '12.00', stock: 5 });
    await stockAt(replacement.id, 5);

    const res = await sell({
      lines: [{ productId: replacement.id, quantity: 1 }],
      method: 'cash',
      tendered: '12.00',
      exchangeReturnId: 'not-a-real-return-id',
    });

    expect(res.status).toBe(404);
  });
});
