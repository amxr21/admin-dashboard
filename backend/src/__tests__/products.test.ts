import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { ProductStatus, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Product catalogue routes.
 *
 * The cases that matter most are the ones a happy-path test would miss:
 * money surviving the round trip exactly, a delete not rewriting order
 * history, and the page-size ceiling holding.
 */

/**
 * Supertest types `res.body` as `any`. Casting through named shapes keeps the
 * assertions honest and satisfies no-unsafe-member-access, matching
 * auth.test.ts.
 */
interface ProductBody {
  data: { product: { id: string; price: string; status: string; sku: string | null } };
}
interface ListBody {
  data: {
    products: { id: string; sku: string | null; status: string }[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
interface DeleteBody {
  data: { archived: boolean; product: { id: string } };
}

const app = createApp();

const RUN = `producttest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: string[] = [];
const createdProductIds: string[] = [];
let categoryId = '';
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
  createdUserIds.push(user.id);
  return signToken(user);
}

async function makeProduct(overrides: Record<string, unknown> = {}) {
  const product = await prisma.product.create({
    data: {
      name: `${RUN} widget`,
      price: '19.99',
      categoryId,
      ...overrides,
    },
  });
  createdProductIds.push(product.id);
  return product;
}

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { name: `${RUN} category`, slug: `${RUN}-category` },
  });
  categoryId = category.id;

  [ownerToken, demoToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.orderItem.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/products');

    expect(res.status).toBe(401);
  });

  it('rejects a role without the products area', async () => {
    // SUPPORT handles customers and orders, not the catalogue. 403 rather
    // than 404: the caller is authenticated and the resource exists.
    const res = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${supportToken}`);

    expect(res.status).toBe(403);
  });

  it('lets the demo role READ', async () => {
    const res = await request(app)
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${demoToken}`);

    expect(res.status).toBe(200);
  });

  it('blocks the demo role from WRITING', async () => {
    // The demo account is handed to prospective clients. It must be provably
    // incapable of changing the catalogue.
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${demoToken}`)
      .send({ name: 'demo write', price: '1.00' });

    expect(res.status).toBe(403);
  });

  it('blocks the demo role from DELETING', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .delete(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${demoToken}`);

    expect(res.status).toBe(403);
    // And the row is still there.
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
  });
});

describe('money precision', () => {
  it('returns price as a string, not a number', async () => {
    // A JSON number would already have lost precision inside JSON.parse on
    // the client, before any of our code could intervene.
    const product = await makeProduct({ price: '1234.56' });

    const res = await request(app)
      .get(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as ProductBody).data.product.price).toBe('1234.56');
    expect(typeof (res.body as ProductBody).data.product.price).toBe('string');
  });

  it('round-trips a price through create and read unchanged', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `${RUN} precise`, price: '99999.99' });

    expect(res.status).toBe(201);
    createdProductIds.push((res.body as ProductBody).data.product.id);
    expect((res.body as ProductBody).data.product.price).toBe('99999.99');
  });

  it('always renders two decimal places', async () => {
    // "20" and "20.00" are the same amount but not the same string; the UI
    // formats what it is given, so the API must be consistent.
    const product = await makeProduct({ price: '20' });

    const res = await request(app)
      .get(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect((res.body as ProductBody).data.product.price).toBe('20.00');
  });

  it('rejects a price with more than two decimal places', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'too precise', price: '1.005' });

    expect(res.status).toBe(400);
  });

  it('rejects a price sent as a JSON number', async () => {
    // Accepting this would make the string discipline pointless — the loss
    // happens in JSON.parse, upstream of every check we control.
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'numeric price', price: 19.99 });

    expect(res.status).toBe(400);
  });
});

describe('validation', () => {
  it('rejects an unknown field', async () => {
    // .strict() — silently accepting extra fields is how mass assignment
    // vulnerabilities happen.
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'x', price: '1.00', isAdmin: true });

    expect(res.status).toBe(400);
  });

  it('rejects negative stock', async () => {
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'x', price: '1.00', stock: -5 });

    expect(res.status).toBe(400);
  });

  it('rejects an empty PATCH', async () => {
    // Almost always a client bug. Returning 200 hides it.
    const product = await makeProduct();

    const res = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 naming the field for a category that does not exist', async () => {
    // Without the pre-check this is a foreign-key violation — a 500 that
    // tells the user nothing about what they got wrong.
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'x', price: '1.00', categoryId: 'does-not-exist' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('categoryId');
  });

  it('returns 409 for a duplicate SKU', async () => {
    const sku = `${RUN}-SKU`;
    await makeProduct({ sku });

    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'dupe', price: '1.00', sku });

    // 409, not a 500 leaking the Prisma error and the schema with it.
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app)
      .get('/api/v1/products/does-not-exist')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });
});

describe('listing', () => {
  it('caps page size so ?limit=100000 cannot scrape the catalogue', async () => {
    const res = await request(app)
      .get('/api/v1/products?limit=100000')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
  });

  it('filters by status', async () => {
    await makeProduct({ name: `${RUN} drafted`, status: ProductStatus.DRAFT });

    const res = await request(app)
      .get(`/api/v1/products?status=DRAFT&search=${RUN}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as ListBody).data.products.length).toBeGreaterThan(0);
    for (const product of (res.body as ListBody).data.products) {
      expect(product.status).toBe('DRAFT');
    }
  });

  it('searches by SKU as well as name', async () => {
    // Staff look products up by either; a name-only search sends them to the
    // database by hand.
    const sku = `${RUN}-FINDME`;
    await makeProduct({ name: `${RUN} unrelated name`, sku });

    const res = await request(app)
      .get(`/api/v1/products?search=${sku}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect((res.body as ListBody).data.products.map((p) => p.sku)).toContain(sku);
  });

  it('reports pagination metadata consistent with the page returned', async () => {
    const res = await request(app)
      .get(`/api/v1/products?search=${RUN}&limit=2&page=1`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as ListBody).data.products.length).toBeLessThanOrEqual(2);
    expect((res.body as ListBody).data.limit).toBe(2);
    expect((res.body as ListBody).data.page).toBe(1);
    expect((res.body as ListBody).data.totalPages).toBe(
      Math.max(1, Math.ceil((res.body as ListBody).data.total / 2)),
    );
  });
});

describe('deletion preserves order history', () => {
  it('archives a product that appears in an order instead of deleting it', async () => {
    // OrderItem.productId is SetNull. A hard delete would blank the line item
    // in a past order — silently rewriting a customer's order history.
    const product = await makeProduct({ name: `${RUN} ordered` });

    const customer = await prisma.customer.create({
      data: { name: `${RUN} buyer`, email: `${RUN}-buyer@example.test` },
    });
    const order = await prisma.order.create({
      data: { customerId: customer.id, orderNumber: `${RUN}-ORD`, total: '19.99' },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: product.id, quantity: 1, price: '19.99' },
    });

    const res = await request(app)
      .delete(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as DeleteBody).data.archived).toBe(true);

    // Still present, and still attached to the order line.
    const still = await prisma.product.findUnique({ where: { id: product.id } });
    expect(still?.status).toBe(ProductStatus.ARCHIVED);

    const item = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(item?.productId).toBe(product.id);

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  });

  it('hard-deletes a product that was never ordered', async () => {
    // Catalogue mistakes should not linger in every list forever.
    const product = await makeProduct({ name: `${RUN} never ordered` });

    const res = await request(app)
      .delete(`/api/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect((res.body as DeleteBody).data.archived).toBe(false);
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(0);
  });
});
