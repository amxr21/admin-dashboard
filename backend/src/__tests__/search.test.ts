import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Cross-entity search (C4.2) — the backend half of the global search box.
 *
 * Highest-value property to pin: per-category gating. A role that can see
 * orders but not products must get order hits and an EMPTY products array,
 * never a 403 for the whole request (some categories are still real,
 * answerable questions) and never product rows it has no business seeing.
 */

const app = createApp();

const RUN = `searchtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let orderId = '';
let customerId = '';
let productId = '';
let ownerToken = '';
let supportToken = ''; // orders + customers, NOT products
let fulfillmentToken = ''; // orders + products, NOT customers

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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  [ownerToken, supportToken, fulfillmentToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.SUPPORT),
    makeUser(StaffRole.FULFILLMENT),
  ]);

  const customer = await prisma.customer.create({
    data: { name: `${RUN} Zephyr Customer`, email: `${RUN}-zephyr@example.test` },
  });
  customerId = customer.id;

  const product = await prisma.product.create({
    data: { name: `${RUN} Zephyr Lamp`, sku: `${RUN}-SKU`, price: new Prisma.Decimal('29.99'), stock: 5 },
  });
  productId = product.id;

  const order = await prisma.order.create({
    data: {
      orderNumber: `${RUN}-ZEPHYR-1`,
      status: 'PENDING',
      total: new Prisma.Decimal('29.99'),
      customerId,
      items: { create: [{ productId, quantity: 1, price: new Prisma.Decimal('29.99') }] },
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

interface SearchBody {
  data: {
    orders: { id: string; title: string; subtitle: string | null; href: string }[];
    customers: { id: string; title: string; subtitle: string | null; href: string }[];
    products: { id: string; title: string; subtitle: string | null; href: string }[];
  };
}

describe('authorisation', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'zephyr' });
    expect(res.status).toBe(401);
  });

  it('does not require any specific area — any authenticated role may search', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'zephyr' }).set(auth(supportToken));
    expect(res.status).toBe(200);
  });
});

describe('matches across categories', () => {
  it('finds the order by order number', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN}-ZEPHYR` })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    expect(body.data.orders.map((o) => o.id)).toContain(orderId);
  });

  it('finds the order by customer name', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'Zephyr Customer' })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    expect(body.data.orders.map((o) => o.id)).toContain(orderId);
  });

  it('finds the customer by email', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN}-zephyr@example.test` })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    expect(body.data.customers.map((c) => c.id)).toContain(customerId);
  });

  it('finds the product by SKU', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN}-SKU` })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    expect(body.data.products.map((p) => p.id)).toContain(productId);
  });

  it('finds the product by name', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'Zephyr Lamp' })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    expect(body.data.products.map((p) => p.id)).toContain(productId);
  });
});

describe('per-category permission gating', () => {
  it('SUPPORT (orders + customers, not products) gets product hits withheld, not a 403', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN} Zephyr` })
      .set(auth(supportToken));

    expect(res.status).toBe(200);
    const body = res.body as SearchBody;
    expect(body.data.orders.length).toBeGreaterThan(0);
    expect(body.data.customers.length).toBeGreaterThan(0);
    expect(body.data.products).toEqual([]);
  });

  it('FULFILLMENT (orders + products, not customers) gets customer hits withheld', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN}-zephyr@example.test` })
      .set(auth(fulfillmentToken));

    expect(res.status).toBe(200);
    const body = res.body as SearchBody;
    // FULFILLMENT can't reach customers at all — the email-only match must
    // not leak through via the order's own customer relation either.
    expect(body.data.customers).toEqual([]);
  });
});

describe('short and empty queries', () => {
  it('returns everything empty for a query below the minimum length', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'z' }).set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as SearchBody;
    expect(body.data).toEqual({ orders: [], customers: [], products: [] });
  });

  it('rejects a query over the length ceiling as a 400, not a truncated search', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'x'.repeat(121) })
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
  });
});

describe('result shape', () => {
  it('gives every hit a working href into the resource that already exists', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN}-SKU` })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    const hit = body.data.products.find((p) => p.id === productId);
    expect(hit?.href).toBe(`/admin/r/products?search=${encodeURIComponent(`${RUN}-SKU`)}`);
  });

  it("gives the order hit a real detail-page href, since orders HAS one", async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: `${RUN}-ZEPHYR` })
      .set(auth(ownerToken));

    const body = res.body as SearchBody;
    const hit = body.data.orders.find((o) => o.id === orderId);
    expect(hit?.href).toBe(`/admin/orders/${orderId}`);
  });
});
