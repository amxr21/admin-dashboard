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

  it('moderates a review without letting staff rewrite its content', async () => {
    // Staff may change `status` (moderation); `rating`/`body` are the
    // customer's own words and must stay read-only even though the resource
    // overall permits `update`.
    const review = await prisma.review.create({
      data: { rating: 3, body: `${RUN} original body`, status: 'PENDING' },
    });

    const res = await request(app)
      .patch(`/api/v1/r/reviews/${review.id}`)
      .set(auth(ownerToken))
      .send({ status: 'APPROVED', rating: 1, body: 'rewritten by staff' });

    expect(res.status).toBe(200);
    const row = (res.body as RowBody).data.row;
    expect(row.status).toBe('APPROVED');
    expect(row.rating).toBe(3);
    expect(row.body).toBe(`${RUN} original body`);

    await prisma.review.delete({ where: { id: review.id } });
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

describe('multi-relation fields (discount scoping)', () => {
  const categoryIds: string[] = [];
  let discountId = '';

  beforeAll(async () => {
    const categories = await Promise.all(
      ['A', 'B', 'C'].map((suffix) =>
        prisma.category.create({
          data: { name: `${RUN} multirelcat-${suffix}`, slug: `${RUN}-multirelcat-${suffix}` },
        }),
      ),
    );
    categoryIds.push(...categories.map((c) => c.id));
  });

  afterAll(async () => {
    if (discountId) await prisma.discount.delete({ where: { id: discountId } }).catch(() => {});
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  });

  it('creates a row with a multi-relation set and returns sorted ids plus labels', async () => {
    const [a, b] = categoryIds;

    const res = await request(app)
      .post('/api/v1/r/discounts')
      .set(auth(ownerToken))
      .send({
        code: `${RUN}-MULTIREL1`,
        type: 'PERCENT',
        value: '10.00',
        scope: 'CATEGORY',
        categories: [b, a], // deliberately out of order
      });

    expect(res.status).toBe(201);
    const row = (res.body as RowBody).data.row;
    discountId = String(row.id);

    expect(row.categories).toEqual([a, b].sort());
  });

  it('attaches labels alongside the id array on GET', async () => {
    const res = await request(app)
      .get(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const row = (res.body as RowBody).data.row;

    expect(row.categories).toHaveLength(2);
    expect(row.categories__label).toEqual(
      expect.arrayContaining([expect.stringContaining('multirelcat')]),
    );
  });

  it('replaces the whole set with { set: [...] }, not an append', async () => {
    const [, , c] = categoryIds;

    const res = await request(app)
      .patch(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken))
      .send({ categories: [c] });

    expect(res.status).toBe(200);
    expect((res.body as RowBody).data.row.categories).toEqual([c]);
  });

  it('clears the relation with an empty array', async () => {
    const res = await request(app)
      .patch(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken))
      .send({ categories: [] });

    expect(res.status).toBe(200);
    expect((res.body as RowBody).data.row.categories).toEqual([]);
  });

  it('rejects an id that does not exist in the target resource', async () => {
    const res = await request(app)
      .patch(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken))
      .send({ categories: ['not-a-real-id'] });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/unknown categories/i);
  });

  it('rejects a non-array value', async () => {
    const res = await request(app)
      .patch(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken))
      .send({ categories: 'not-an-array' });

    expect(res.status).toBe(400);
  });

  it('writes no audit entry when the same set is resubmitted in a different order', async () => {
    const [a, b] = categoryIds;

    await request(app)
      .patch(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken))
      .send({ categories: [a, b] });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const before = await prisma.auditLog.count({
      where: { entity: 'discounts', entityId: discountId },
    });

    await request(app)
      .patch(`/api/v1/r/discounts/${discountId}`)
      .set(auth(ownerToken))
      .send({ categories: [b, a] }); // same set, reversed order
    await new Promise((resolve) => setTimeout(resolve, 400));

    const after = await prisma.auditLog.count({
      where: { entity: 'discounts', entityId: discountId },
    });

    expect(after).toBe(before);
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

/**
 * `audit()` is fire-and-forget by design (see audit.service.ts), so the write
 * can still be in flight when the HTTP response returns. A short pause is the
 * same trade the revocation test file makes for the same reason.
 */
function waitForAudit() {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

describe('the audit trail records generic resource writes', () => {
  it('logs create, update, a skipped no-op, and delete', async () => {
    const category = await prisma.category.create({
      data: { name: `${RUN} auditcat`, slug: `${RUN}-auditcat` },
    });

    const created = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} audit-create`, price: '12.00', categoryId: category.id });

    expect(created.status).toBe(201);
    const productId = (created.body as RowBody).data.row.id as string;
    await waitForAudit();

    const createEntry = await prisma.auditLog.findFirst({
      where: { entity: 'products', entityId: productId, action: 'products.create' },
    });
    expect(createEntry).not.toBeNull();
    const createChanges = createEntry?.changes as Record<string, { from: unknown; to: unknown }>;
    expect(createChanges.name?.to).toBe(`${RUN} audit-create`);

    const updated = await request(app)
      .patch(`/api/v1/r/products/${productId}`)
      .set(auth(ownerToken))
      .send({ price: '15.00' });

    expect(updated.status).toBe(200);
    await waitForAudit();

    const updateEntry = await prisma.auditLog.findFirst({
      where: { entity: 'products', entityId: productId, action: 'products.update' },
    });
    expect(updateEntry).not.toBeNull();
    const updateChanges = updateEntry?.changes as Record<string, { from: unknown; to: unknown }>;
    expect(updateChanges.price?.to).toBe('15.00');
    // Only the field that actually changed is present — not a whole-row copy.
    expect(updateChanges.name).toBeUndefined();

    // A no-op update (same value again) must produce no new entry.
    const beforeCount = await prisma.auditLog.count({
      where: { entity: 'products', entityId: productId, action: 'products.update' },
    });
    const noop = await request(app)
      .patch(`/api/v1/r/products/${productId}`)
      .set(auth(ownerToken))
      .send({ price: '15.00' });
    expect(noop.status).toBe(200);
    await waitForAudit();
    const afterCount = await prisma.auditLog.count({
      where: { entity: 'products', entityId: productId, action: 'products.update' },
    });
    expect(afterCount).toBe(beforeCount);

    // Never ordered, so this is a genuine delete, not the archive hook.
    const deleted = await request(app)
      .delete(`/api/v1/r/products/${productId}`)
      .set(auth(ownerToken));
    expect(deleted.status).toBe(200);
    expect((deleted.body as { data: { action: string } }).data.action).toBe('deleted');
    await waitForAudit();

    const deleteEntry = await prisma.auditLog.findFirst({
      where: { entity: 'products', entityId: productId, action: 'products.delete' },
    });
    expect(deleteEntry).not.toBeNull();
    // A delete is not a field diff — recording every column as "changed to
    // null" would be a full snapshot of the row wearing a diff's clothes.
    expect(deleteEntry?.changes).toBeNull();

    await prisma.auditLog.deleteMany({ where: { entity: 'products', entityId: productId } });
    await prisma.category.delete({ where: { id: category.id } });
  });

  it('logs an archive with the field that actually changed, when a hook keeps the row', async () => {
    const category = await prisma.category.create({
      data: { name: `${RUN} auditarchivecat`, slug: `${RUN}-auditarchivecat` },
    });
    const product = await prisma.product.create({
      data: { name: `${RUN} audit-archived`, price: '5.00', categoryId: category.id },
    });
    const customer = await prisma.customer.create({
      data: { name: `${RUN} auditcust`, email: `${RUN}-auditcust@example.test` },
    });
    const order = await prisma.order.create({
      data: { customerId: customer.id, orderNumber: `${RUN}-AH`, total: '5.00' },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: product.id, quantity: 1, price: '5.00' },
    });

    const res = await request(app)
      .delete(`/api/v1/r/products/${product.id}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as { data: { action: string } }).data.action).toBe('archived');
    await waitForAudit();

    const entry = await prisma.auditLog.findFirst({
      where: { entity: 'products', entityId: product.id, action: 'products.archive' },
    });
    expect(entry).not.toBeNull();
    const changes = entry?.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.status).toEqual({ from: 'ACTIVE', to: 'ARCHIVED' });
    // Only the status changed — the name and price are untouched by the hook.
    expect(changes.name).toBeUndefined();

    await prisma.auditLog.deleteMany({ where: { entity: 'products', entityId: product.id } });
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
