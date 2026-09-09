import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Product tags (S7.9) — free-text, reused by NAME (the owner's own call).
 *
 * ─── WHAT THESE PROTECT ───────────────────────────────────────────────
 * The one behaviour that matters here: typing the same tag text twice
 * (on the same product, or on two different ones) must reuse the existing
 * `Tag` row, never insert a near-duplicate. `connectOrCreate` is supposed
 * to guarantee this at the database level (the unique constraint on
 * `Tag.name`), but the coercion layer in front of it (`coerceTagsValue`)
 * is what turns free text into that call correctly — trimmed,
 * de-duplicated, and replacing the WHOLE list rather than only adding.
 */

const app = createApp();

interface RowBody {
  data: { row: Record<string, unknown> & { tags?: string[]; tags__label?: string[] } };
}
interface ErrorBody {
  error: { code: string; message: string };
}

const RUN = `producttags-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const productIds: string[] = [];
const tagIds: string[] = [];
let ownerToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function makeProduct(name: string) {
  const product = await prisma.product.create({
    data: { name, price: new Prisma.Decimal('9.99') },
  });
  productIds.push(product.id);
  return product.id;
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: 'Owner',
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(owner.id);
  ownerToken = signToken(owner);
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  // Tags created by these tests, found by name prefix rather than a
  // maintained id list — connectOrCreate can create a tag this suite never
  // captured an id for directly.
  await prisma.tag.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('creating a product with tags', () => {
  it('creates new Tag rows for names that do not exist yet', async () => {
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({
        name: `${RUN} Product A`,
        price: '9.99',
        tags: [`${RUN}-fragile`, `${RUN}-seasonal`],
      });

    expect(res.status).toBe(201);
    productIds.push((res.body as RowBody).data.row.id as string);

    const rows = await prisma.tag.findMany({ where: { name: { startsWith: RUN } } });
    expect(rows.map((r) => r.name).sort()).toEqual([`${RUN}-fragile`, `${RUN}-seasonal`].sort());
  });

  it('reuses an existing tag by name instead of creating a near-duplicate', async () => {
    const existing = await prisma.tag.create({ data: { name: `${RUN}-bestseller` } });
    tagIds.push(existing.id);

    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Product B`, price: '9.99', tags: [`${RUN}-bestseller`] });

    expect(res.status).toBe(201);
    productIds.push((res.body as RowBody).data.row.id as string);

    const count = await prisma.tag.count({ where: { name: `${RUN}-bestseller` } });
    expect(count).toBe(1);

    const relation = await prisma.product.findUnique({
      where: { id: (res.body as RowBody).data.row.id as string },
      select: { tags: { select: { id: true } } },
    });
    expect(relation?.tags.map((t) => t.id)).toEqual([existing.id]);
  });

  it('trims whitespace and drops empty entries', async () => {
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Product C`, price: '9.99', tags: [`  ${RUN}-trimmed  `, '', '   '] });

    expect(res.status).toBe(201);
    const id = (res.body as RowBody).data.row.id as string;
    productIds.push(id);

    const relation = await prisma.product.findUnique({
      where: { id },
      select: { tags: { select: { name: true } } },
    });
    expect(relation?.tags.map((t) => t.name)).toEqual([`${RUN}-trimmed`]);
  });

  it('refuses a non-string entry', async () => {
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Product D`, price: '9.99', tags: [123] });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/list of tag names/i);
  });
});

describe('updating a product\'s tags', () => {
  it('replaces the whole list — omitting a previously-set tag removes it', async () => {
    const id = await makeProduct(`${RUN} Product E`);

    const first = await request(app)
      .patch(`/api/v1/r/products/${id}`)
      .set(auth(ownerToken))
      .send({ tags: [`${RUN}-a`, `${RUN}-b`] });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/v1/r/products/${id}`)
      .set(auth(ownerToken))
      .send({ tags: [`${RUN}-a`] }); // b dropped
    expect(second.status).toBe(200);

    const relation = await prisma.product.findUnique({
      where: { id },
      select: { tags: { select: { name: true } } },
    });
    expect(relation?.tags.map((t) => t.name)).toEqual([`${RUN}-a`]);
  });

  it('clears every tag when sent an empty array', async () => {
    const id = await makeProduct(`${RUN} Product F`);

    await request(app)
      .patch(`/api/v1/r/products/${id}`)
      .set(auth(ownerToken))
      .send({ tags: [`${RUN}-clearme`] });

    const res = await request(app)
      .patch(`/api/v1/r/products/${id}`)
      .set(auth(ownerToken))
      .send({ tags: [] });
    expect(res.status).toBe(200);

    const relation = await prisma.product.findUnique({
      where: { id },
      select: { tags: { select: { id: true } } },
    });
    expect(relation?.tags).toEqual([]);
  });

  it('does not disturb tags when the field is omitted entirely', async () => {
    const id = await makeProduct(`${RUN} Product G`);

    await request(app)
      .patch(`/api/v1/r/products/${id}`)
      .set(auth(ownerToken))
      .send({ tags: [`${RUN}-untouched`] });

    const res = await request(app)
      .patch(`/api/v1/r/products/${id}`)
      .set(auth(ownerToken))
      .send({ name: `${RUN} Product G renamed` }); // no `tags` key at all
    expect(res.status).toBe(200);

    const relation = await prisma.product.findUnique({
      where: { id },
      select: { tags: { select: { name: true } } },
    });
    expect(relation?.tags.map((t) => t.name)).toEqual([`${RUN}-untouched`]);
  });
});

describe('reading tags back', () => {
  it('lists a product\'s tag names on the row', async () => {
    const res = await request(app)
      .post('/api/v1/r/products')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Product H`, price: '9.99', tags: [`${RUN}-x`, `${RUN}-y`] });

    productIds.push((res.body as RowBody).data.row.id as string);

    const listRes = await request(app)
      .get(`/api/v1/r/products?search=${encodeURIComponent(`${RUN} Product H`)}`)
      .set(auth(ownerToken));

    expect(listRes.status).toBe(200);
    const body = listRes.body as { data: { rows: Record<string, unknown>[] } };
    const row = body.data.rows[0];
    expect(row?.tags__label).toEqual(expect.arrayContaining([`${RUN}-x`, `${RUN}-y`]));
  });
});
