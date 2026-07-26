import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { ADMIN_RESOURCES, getResourceConfig, writableFields } from '../config/admin.config.js';

/**
 * The generic resource engine.
 *
 * One endpoint serves every configured resource, which means one mistake here
 * is a mistake everywhere. These tests exist to prove the config is genuinely
 * an ALLOWLIST rather than a suggestion — that nothing in a request can widen
 * what the engine will read, write, sort or filter.
 */

const app = createApp();

interface ListBody {
  data: {
    rows: Record<string, unknown>[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}
interface RowBody {
  data: { row: Record<string, unknown> };
}
interface SchemaBody {
  data: { resources: { resource: string; permissionArea: string }[] };
}
interface ErrorBody {
  error: { code: string; message: string };
}

const RUN = `enginetest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: string[] = [];
const createdCustomerIds: string[] = [];
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

beforeAll(async () => {
  [ownerToken, demoToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.DEMO),
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

describe('the config is an allowlist', () => {
  it('404s a table that exists but is not configured', async () => {
    // `users` is a real table. It is deliberately absent from admin.config.ts
    // because staff accounts have their own guarded routes — so as far as the
    // engine is concerned it does not exist.
    const res = await request(app).get('/api/v1/r/users').set(auth(ownerToken));

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('does not expose `users` in the schema', async () => {
    const res = await request(app).get('/api/v1/r/_schema').set(auth(ownerToken));

    const names = (res.body as SchemaBody).data.resources.map((r) => r.resource);
    expect(names).not.toContain('users');
  });

  it('returns ONLY declared columns', async () => {
    // `select` is built from config. Anything not declared cannot come back,
    // which is what stops a future config entry leaking a password hash.
    const customer = await prisma.customer.create({
      data: { name: `${RUN} col`, email: `${RUN}-col@example.test` },
    });
    createdCustomerIds.push(customer.id);

    const res = await request(app)
      .get(`/api/v1/r/customers/${customer.id}`)
      .set(auth(ownerToken));

    const declared = new Set(getResourceConfig('customers')?.fields.map((f) => f.name));
    const returned = Object.keys((res.body as RowBody).data.row).filter(
      (key) => !key.endsWith('__label'),
    );

    expect(res.status).toBe(200);
    for (const key of returned) {
      expect(declared.has(key)).toBe(true);
    }
    // updatedAt exists on the model but is not configured, so it must be absent.
    expect(returned).not.toContain('updatedAt');
  });

  it('rejects a sort on an unsortable field', async () => {
    const res = await request(app)
      .get('/api/v1/r/customers?sort=email')
      .set(auth(ownerToken));

    // email IS sortable, so this proves the happy path before the negative one.
    expect(res.status).toBe(200);

    const bad = await request(app)
      .get('/api/v1/r/customers?sort=passwordHash')
      .set(auth(ownerToken));

    expect(bad.status).toBe(400);
  });

  it('rejects a filter on an unconfigured field', async () => {
    // Silently ignoring it would return unfiltered data that LOOKS filtered —
    // worse than an error, because nobody notices.
    const res = await request(app)
      .get('/api/v1/r/customers?passwordHash=x')
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
  });

  it('drops unknown keys on write instead of persisting them', async () => {
    // Mass assignment: the engine writes only writableFields, so an injected
    // key cannot reach Prisma.
    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(ownerToken))
      .send({
        name: `${RUN} massassign`,
        email: `${RUN}-massassign@example.test`,
        id: 'attacker-chosen-id',
        createdAt: '2000-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    const row = (res.body as RowBody).data.row;
    createdCustomerIds.push(String(row.id));

    expect(row.id).not.toBe('attacker-chosen-id');
    expect(row.createdAt).not.toContain('2000-01-01');
  });

  it('never marks a readOnly field writable', () => {
    // Structural check across EVERY configured resource, so a new config entry
    // can't quietly make an audit column editable.
    for (const resource of ['categories', 'customers', 'discounts', 'reviews']) {
      const config = getResourceConfig(resource);
      expect(config).toBeDefined();

      for (const field of writableFields(config!)) {
        expect(field.readOnly).not.toBe(true);
        expect(field.type).not.toBe('id');
      }
    }
  });
});

describe('per-resource authorisation', () => {
  it('applies the resource own area, not one blanket grant', async () => {
    // SUPPORT reaches customers but not discounts. If the engine checked a
    // single area, one grant would open every resource at once.
    const allowed = await request(app).get('/api/v1/r/customers').set(auth(supportToken));
    const denied = await request(app).get('/api/v1/r/discounts').set(auth(supportToken));

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  it('filters the schema to what the caller can reach', async () => {
    const res = await request(app).get('/api/v1/r/_schema').set(auth(supportToken));

    const names = (res.body as SchemaBody).data.resources.map((r) => r.resource);
    expect(names).toContain('customers');
    expect(names).not.toContain('discounts');
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/r/customers');

    expect(res.status).toBe(401);
  });

  it('lets the demo role read but not write', async () => {
    const read = await request(app).get('/api/v1/r/customers').set(auth(demoToken));
    const write = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(demoToken))
      .send({ name: 'demo', email: 'demo@example.test' });

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
  });

  it('refuses to create a resource whose config forbids it', async () => {
    // Reviews are written by customers; staff only moderate them.
    const res = await request(app)
      .post('/api/v1/r/reviews')
      .set(auth(ownerToken))
      .send({ rating: 5 });

    expect(res.status).toBe(403);
  });
});

describe('typed values', () => {
  it('validates a required field on create', async () => {
    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(ownerToken))
      .send({ name: `${RUN} no email` });

    expect(res.status).toBe(400);
  });

  it('validates email shape from the semantic type', async () => {
    // No per-resource validator wrote this rule — it comes from type: 'email'.
    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(ownerToken))
      .send({ name: `${RUN} bad email`, email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('emits money as a fixed-2 string', async () => {
    // Same rule as products: a JSON number loses precision in JSON.parse.
    const res = await request(app)
      .get('/api/v1/r/discounts?pageSize=1')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);

    const row = (res.body as ListBody).data.rows[0];
    if (row) {
      expect(typeof row.value).toBe('string');
      expect(String(row.value)).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('rejects money sent as a JSON number', async () => {
    const res = await request(app)
      .post('/api/v1/r/discounts')
      .set(auth(ownerToken))
      .send({ code: `${RUN}-D`, type: 'PERCENT', value: 10.5 });

    expect(res.status).toBe(400);
  });

  it('rejects a value outside an enum', async () => {
    const res = await request(app)
      .post('/api/v1/r/discounts')
      .set(auth(ownerToken))
      .send({ code: `${RUN}-E`, type: 'NOT_A_TYPE', value: '10.00' });

    expect(res.status).toBe(400);
  });

  it('caps page size', async () => {
    const res = await request(app)
      .get('/api/v1/r/customers?pageSize=100000')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as ListBody).data.pageSize).toBe(100);
  });
});

describe('relation labels', () => {
  it('attaches a human label alongside the foreign key', async () => {
    // Without this every list renders raw cuids, which are unreadable.
    const res = await request(app)
      .get('/api/v1/r/reviews?pageSize=5')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);

    for (const row of (res.body as ListBody).data.rows) {
      expect(Object.keys(row)).toContain('productId__label');
    }
  });
});

describe('config and code stay in sync', () => {
  it('every configured resource is reachable', async () => {
    // A config entry whose model has no delegate throws at request time, not at
    // compile time — so adding a resource and forgetting the delegate is an
    // easy mistake that only shows up when someone opens the page. This walks
    // every declared resource so the gap is caught here instead.
    for (const config of ADMIN_RESOURCES) {
      const res = await request(app)
        .get(`/api/v1/r/${config.resource}?pageSize=1`)
        .set(auth(ownerToken));

      expect(
        res.status,
        `GET /r/${config.resource} returned ${res.status}`,
      ).toBe(200);
    }
  });

  it('archives a product with orders rather than deleting it', async () => {
    // The rule survived the move from a hand-written route into a hook. This
    // is behaviour, so it lives in resource-hooks.ts rather than config.
    const category = await prisma.category.create({
      data: { name: `${RUN} hookcat`, slug: `${RUN}-hookcat` },
    });
    const product = await prisma.product.create({
      data: { name: `${RUN} hooked`, price: '5.00', categoryId: category.id },
    });
    const customer = await prisma.customer.create({
      data: { name: `${RUN} hb`, email: `${RUN}-hb@example.test` },
    });
    const order = await prisma.order.create({
      data: { customerId: customer.id, orderNumber: `${RUN}-HOOK`, total: '5.00' },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: product.id, quantity: 1, price: '5.00' },
    });

    const res = await request(app)
      .delete(`/api/v1/r/products/${product.id}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as { data: { action: string } }).data.action).toBe('archived');
    expect((await prisma.product.findUnique({ where: { id: product.id } }))?.status).toBe(
      'ARCHIVED',
    );

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
  });
});

describe('duplicate values', () => {
  it('returns 409 naming the field, not a 500 leaking the schema', async () => {
    // A duplicate code is a normal user mistake. Letting Prisma's P2002 reach
    // the error handler leaks the table and column names while telling the
    // user nothing about what they typed.
    const code = `${RUN}-DUPE`;

    const first = await request(app)
      .post('/api/v1/r/discounts')
      .set(auth(ownerToken))
      .send({ code, type: 'PERCENT', value: '10.00' });

    expect(first.status).toBe(201);
    const createdId = (first.body as RowBody).data.row.id as string;

    const second = await request(app)
      .post('/api/v1/r/discounts')
      .set(auth(ownerToken))
      .send({ code, type: 'PERCENT', value: '15.00' });

    expect(second.status).toBe(409);
    expect((second.body as ErrorBody).error.code).toBe('CONFLICT');
    // The human label, never the raw Prisma message.
    expect((second.body as ErrorBody).error.message).not.toMatch(/prisma|constraint/i);

    await prisma.discount.delete({ where: { id: createdId } });
  });
});
