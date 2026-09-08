import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

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
const businessIds: string[] = [];

let branchId = '';
let ownerToken = '';
let supportToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
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
  price?: string;
  stock?: number;
  status?: ProductStatus;
}) {
  const product = await prisma.product.create({
    data: {
      name: `${RUN} ${opts.sku ?? opts.barcode ?? 'item'}`,
      price: new Prisma.Decimal(opts.price ?? '5.00'),
      stock: opts.stock ?? 0,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.barcode ? { barcode: opts.barcode } : {}),
      ...(opts.sku ? { sku: opts.sku } : {}),
    },
  });
  productIds.push(product.id);
  return product;
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
  await prisma.branchStock.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
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
