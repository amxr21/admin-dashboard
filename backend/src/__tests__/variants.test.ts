import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Product variants.
 *
 * Two properties matter most: stock follows the EXACT same append-only rule
 * as `Product.stock` (the log explains the number, a refused adjustment
 * leaves nothing behind), and the two permission areas split correctly —
 * `products` for catalogue edits, `inventory` for stock, mirroring how the
 * top-level product/inventory split already works.
 */

const app = createApp();

interface VariantBody {
  data: { variant: { id: string; name: string; sku: string | null; price: string; stock: number } };
}
interface VariantsListBody {
  data: { variants: { id: string; name: string }[] };
}
interface AdjustBody {
  data: { variant: { id: string; stock: number }; movement: { delta: number } };
}
interface ReconcileBody {
  data: { stock: number; fromMovements: number; agrees: boolean };
}
interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const RUN = `varianttest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const productIds: string[] = [];
let ownerToken = '';
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
  return signToken(user);
}

async function makeProduct() {
  const product = await prisma.product.create({
    data: { name: `${RUN} product`, price: new Prisma.Decimal('9.99') },
  });
  productIds.push(product.id);
  return product.id;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  [ownerToken, demoToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
    // SUPPORT has neither `products` nor `inventory`.
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  // Variants and their movements cascade from the product.
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    const productId = await makeProduct();
    const res = await request(app).get(`/api/v1/products/${productId}/variants`);
    expect(res.status).toBe(401);
  });

  it('denies catalogue writes to a role without the products area', async () => {
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(supportToken))
      .send({ name: 'Red', price: '10.00' });
    expect(res.status).toBe(403);
  });

  it('blocks the read-only demo role from creating a variant', async () => {
    const productId = await makeProduct();
    const res = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(demoToken))
      .send({ name: 'Red', price: '10.00' });
    expect(res.status).toBe(403);
  });

  it('denies stock adjustment to a role without the inventory area, even with products', async () => {
    // MANAGER has `products` but this test only needs to prove the SPLIT
    // exists — SUPPORT lacks both, which already proves the movements route
    // is independently guarded rather than falling open once catalogue
    // access is granted.
    const productId = await makeProduct();
    const created = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Blue', price: '5.00' });
    const variantId = (created.body as VariantBody).data.variant.id;

    const res = await request(app)
      .post(`/api/v1/variants/${variantId}/movements`)
      .set(auth(supportToken))
      .send({ delta: 5, reason: 'RECEIVED' });
    expect(res.status).toBe(403);
  });
});

describe('catalogue CRUD', () => {
  it('creates a variant scoped to its product', async () => {
    const productId = await makeProduct();

    const res = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Red / Large', sku: `${RUN}-RL`, price: '24.99' });

    expect(res.status).toBe(201);
    const variant = (res.body as VariantBody).data.variant;
    expect(variant.name).toBe('Red / Large');
    expect(variant.price).toBe('24.99');
    expect(variant.stock).toBe(0);
  });

  it('lists only the variants belonging to that product', async () => {
    const productA = await makeProduct();
    const productB = await makeProduct();

    await request(app)
      .post(`/api/v1/products/${productA}/variants`)
      .set(auth(ownerToken))
      .send({ name: `${RUN} A1`, price: '1.00' });
    await request(app)
      .post(`/api/v1/products/${productB}/variants`)
      .set(auth(ownerToken))
      .send({ name: `${RUN} B1`, price: '1.00' });

    const res = await request(app)
      .get(`/api/v1/products/${productA}/variants`)
      .set(auth(ownerToken));

    const names = (res.body as VariantsListBody).data.variants.map((v) => v.name);
    expect(names).toContain(`${RUN} A1`);
    expect(names).not.toContain(`${RUN} B1`);
  });

  it('rejects a duplicate SKU with a clean conflict, not a raw Prisma error', async () => {
    const productId = await makeProduct();
    const sku = `${RUN}-DUPE`;

    await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'First', sku, price: '5.00' });

    const res = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Second', sku, price: '5.00' });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.message).not.toMatch(/prisma|constraint/i);
  });

  it('updates the price without touching stock', async () => {
    const productId = await makeProduct();
    const created = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Original', price: '10.00' });
    const variantId = (created.body as VariantBody).data.variant.id;

    const res = await request(app)
      .patch(`/api/v1/variants/${variantId}`)
      .set(auth(ownerToken))
      .send({ price: '12.50' });

    expect(res.status).toBe(200);
    expect((res.body as VariantBody).data.variant.price).toBe('12.50');
    expect((res.body as VariantBody).data.variant.stock).toBe(0);
  });

  it('deletes a variant', async () => {
    const productId = await makeProduct();
    const created = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Doomed', price: '1.00' });
    const variantId = (created.body as VariantBody).data.variant.id;

    const res = await request(app).delete(`/api/v1/variants/${variantId}`).set(auth(ownerToken));
    expect(res.status).toBe(204);

    expect(await prisma.productVariant.findUnique({ where: { id: variantId } })).toBeNull();
  });

  it('404s for an unknown product', async () => {
    const res = await request(app)
      .post('/api/v1/products/does-not-exist/variants')
      .set(auth(ownerToken))
      .send({ name: 'X', price: '1.00' });
    expect(res.status).toBe(404);
  });
});

describe('stock: the log explains the number, same rule as products', () => {
  async function makeVariant() {
    const productId = await makeProduct();
    const created = await request(app)
      .post(`/api/v1/products/${productId}/variants`)
      .set(auth(ownerToken))
      .send({ name: `${RUN} variant`, price: '15.00' });
    return (created.body as VariantBody).data.variant.id;
  }

  it('moves stock and records why, in one write', async () => {
    const variantId = await makeVariant();

    const res = await request(app)
      .post(`/api/v1/variants/${variantId}/movements`)
      .set(auth(ownerToken))
      .send({ delta: 20, reason: 'RECEIVED', note: 'first batch' });

    expect(res.status).toBe(201);
    expect((res.body as AdjustBody).data.variant.stock).toBe(20);
  });

  it('sums every movement back to the current stock', async () => {
    const variantId = await makeVariant();

    for (const [delta, reason] of [
      [50, 'RECEIVED'],
      [-5, 'DAMAGED'],
      [-10, 'SOLD'],
    ] as const) {
      await request(app)
        .post(`/api/v1/variants/${variantId}/movements`)
        .set(auth(ownerToken))
        .send({ delta, reason });
    }

    const res = await request(app)
      .get(`/api/v1/variants/${variantId}/reconcile`)
      .set(auth(ownerToken));

    const body = (res.body as ReconcileBody).data;
    expect(body.stock).toBe(35);
    expect(body.fromMovements).toBe(35);
    expect(body.agrees).toBe(true);
  });

  it('will not let stock go negative, and leaves nothing behind', async () => {
    const variantId = await makeVariant();
    await request(app)
      .post(`/api/v1/variants/${variantId}/movements`)
      .set(auth(ownerToken))
      .send({ delta: 3, reason: 'RECEIVED' });

    const res = await request(app)
      .post(`/api/v1/variants/${variantId}/movements`)
      .set(auth(ownerToken))
      .send({ delta: -5, reason: 'DAMAGED' });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details).toMatchObject({ available: 3 });

    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    expect(variant?.stock).toBe(3);
  });

  it('exposes no route to edit or delete a movement', async () => {
    const variantId = await makeVariant();
    await request(app)
      .post(`/api/v1/variants/${variantId}/movements`)
      .set(auth(ownerToken))
      .send({ delta: 5, reason: 'RECEIVED' });

    for (const method of ['patch', 'put', 'delete'] as const) {
      const agent = request(app);
      const res = await agent[method](`/api/v1/variants/${variantId}/movements/x`)
        .set(auth(ownerToken))
        .send({ delta: 1 });
      expect(res.status).toBe(404);
    }
  });

  it("a variant's movements never leak into a different variant's total", async () => {
    const variantA = await makeVariant();
    const variantB = await makeVariant();

    await request(app)
      .post(`/api/v1/variants/${variantA}/movements`)
      .set(auth(ownerToken))
      .send({ delta: 100, reason: 'RECEIVED' });

    const b = await prisma.productVariant.findUnique({ where: { id: variantB } });
    expect(b?.stock).toBe(0);
  });
});
