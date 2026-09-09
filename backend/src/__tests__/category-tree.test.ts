import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * The category tree (S7.6).
 *
 * ─── WHAT THESE PROTECT ───────────────────────────────────────────────
 * Two rules that have to be enforced BEFORE a write commits, not after:
 * a category cannot nest deeper than 3 levels, and it cannot be moved
 * under its own descendant (a cycle). Both live in `resource-hooks.ts`'s
 * `beforeWrite`, the one hook in the generic engine that can refuse a
 * write outright — `afterCreate`/`afterUpdate` only run once the row
 * already exists, too late to undo a bad parent.
 *
 * The third rule — a category with children cannot be deleted — is the
 * owner's own call over silently reparenting them: never lose structure
 * without saying so.
 */

const app = createApp();

interface RowBody {
  data: { row: Record<string, unknown> };
}
interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const RUN = `categorytree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const categoryIds: string[] = [];
let ownerToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function slug(label: string) {
  return `${RUN}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function makeCategory(name: string, parentId?: string) {
  const category = await prisma.category.create({
    data: { name, slug: slug(name), ...(parentId ? { parentId } : {}) },
  });
  categoryIds.push(category.id);
  return category.id;
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
  // Children before parents — the self-relation is Restrict, and a single
  // deleteMany over the whole set does not order itself by depth. Deleting
  // whichever rows are currently leaves, repeatedly, always makes progress
  // regardless of how deep the tree built up during the tests got.
  let remaining = [...categoryIds];
  while (remaining.length > 0) {
    const leaves = await prisma.category.findMany({
      where: { id: { in: remaining }, children: { none: {} } },
      select: { id: true },
    });
    if (leaves.length === 0) break; // Shouldn't happen; avoids an infinite loop if it ever did.

    const leafIds = leaves.map((leaf) => leaf.id);
    await prisma.category.deleteMany({ where: { id: { in: leafIds } } });
    remaining = remaining.filter((id) => !leafIds.includes(id));
  }

  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('nesting depth (S7.6)', () => {
  it('allows a category at the top level', async () => {
    const res = await request(app)
      .post('/api/v1/r/categories')
      .set(auth(ownerToken))
      .send({ name: `${RUN} Level 1`, slug: slug('level1-a') });

    expect(res.status).toBe(201);
    categoryIds.push((res.body as RowBody).data.row.id as string);
  });

  it('allows nesting up to 3 levels', async () => {
    const level1 = await makeCategory(`${RUN} L1`);
    const level2 = await makeCategory(`${RUN} L2`, level1);

    const res = await request(app)
      .post('/api/v1/r/categories')
      .set(auth(ownerToken))
      .send({ name: `${RUN} L3`, slug: slug('l3'), parentId: level2 });

    expect(res.status).toBe(201);
    categoryIds.push((res.body as RowBody).data.row.id as string);
  });

  it('refuses a 4th level', async () => {
    const level1 = await makeCategory(`${RUN} D1`);
    const level2 = await makeCategory(`${RUN} D2`, level1);
    const level3 = await makeCategory(`${RUN} D3`, level2);

    const res = await request(app)
      .post('/api/v1/r/categories')
      .set(auth(ownerToken))
      .send({ name: `${RUN} D4`, slug: slug('d4'), parentId: level3 });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/nest.*3 levels deep/i);

    // Refused — nothing written.
    const created = await prisma.category.findFirst({ where: { name: `${RUN} D4` } });
    expect(created).toBeNull();
  });

  it('also enforces the cap when moving an existing category deeper via update', async () => {
    const level1 = await makeCategory(`${RUN} M1`);
    const level2 = await makeCategory(`${RUN} M2`, level1);
    const level3 = await makeCategory(`${RUN} M3`, level2);
    const mover = await makeCategory(`${RUN} Mover`); // top-level for now

    const res = await request(app)
      .patch(`/api/v1/r/categories/${mover}`)
      .set(auth(ownerToken))
      .send({ parentId: level3 });

    expect(res.status).toBe(400);

    const after = await prisma.category.findUnique({ where: { id: mover } });
    expect(after?.parentId).toBeNull();
  });
});

describe('circular parents (S7.6)', () => {
  it('refuses a category naming itself as its own parent', async () => {
    const id = await makeCategory(`${RUN} Self`);

    const res = await request(app)
      .patch(`/api/v1/r/categories/${id}`)
      .set(auth(ownerToken))
      .send({ parentId: id });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/own parent/i);
  });

  it('refuses moving a category under its own subcategory', async () => {
    const parent = await makeCategory(`${RUN} Cycle Parent`);
    const child = await makeCategory(`${RUN} Cycle Child`, parent);

    const res = await request(app)
      .patch(`/api/v1/r/categories/${parent}`)
      .set(auth(ownerToken))
      .send({ parentId: child });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/own subcategories/i);

    const after = await prisma.category.findUnique({ where: { id: parent } });
    expect(after?.parentId).toBeNull();
  });

  it('refuses a deeper cycle (grandparent moved under its own grandchild)', async () => {
    const grandparent = await makeCategory(`${RUN} GP`);
    const parent = await makeCategory(`${RUN} P`, grandparent);
    const child = await makeCategory(`${RUN} C`, parent);

    const res = await request(app)
      .patch(`/api/v1/r/categories/${grandparent}`)
      .set(auth(ownerToken))
      .send({ parentId: child });

    expect(res.status).toBe(400);
  });
});

describe('deleting a category with children (S7.6)', () => {
  it('blocks the delete and names the child count', async () => {
    const parent = await makeCategory(`${RUN} Del Parent`);
    await makeCategory(`${RUN} Del Child A`, parent);
    await makeCategory(`${RUN} Del Child B`, parent);

    const res = await request(app)
      .delete(`/api/v1/r/categories/${parent}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details?.childCount).toBe(2);

    const stillThere = await prisma.category.findUnique({ where: { id: parent } });
    expect(stillThere).not.toBeNull();
  });

  it('allows deleting a category with no children', async () => {
    const id = await makeCategory(`${RUN} Childless`);

    const res = await request(app)
      .delete(`/api/v1/r/categories/${id}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);

    const gone = await prisma.category.findUnique({ where: { id } });
    expect(gone).toBeNull();

    // Deleted — stop the shared afterAll from trying to delete it again.
    categoryIds.splice(categoryIds.indexOf(id), 1);
  });

  it('allows deleting a child, then its now-childless parent', async () => {
    const parent = await makeCategory(`${RUN} Cascade Parent`);
    const child = await makeCategory(`${RUN} Cascade Child`, parent);

    const first = await request(app)
      .delete(`/api/v1/r/categories/${child}`)
      .set(auth(ownerToken));
    expect(first.status).toBe(200);
    categoryIds.splice(categoryIds.indexOf(child), 1);

    const second = await request(app)
      .delete(`/api/v1/r/categories/${parent}`)
      .set(auth(ownerToken));
    expect(second.status).toBe(200);
    categoryIds.splice(categoryIds.indexOf(parent), 1);
  });
});

describe('the parent label in the response (S7.6)', () => {
  it('shows the parent by name, not just its id', async () => {
    const parent = await makeCategory(`${RUN} Named Parent`);
    const child = await makeCategory(`${RUN} Named Child`, parent);

    const res = await request(app)
      .get(`/api/v1/r/categories?search=${encodeURIComponent(`${RUN} Named Child`)}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as { data: { rows: Record<string, unknown>[] } };
    const row = body.data.rows.find((r) => r.id === child);
    expect(row?.parentId__label).toBe(`${RUN} Named Parent`);
  });
});
