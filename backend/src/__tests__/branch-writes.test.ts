import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Creating and editing businesses and branches (O7 stage 1).
 *
 * ─── WHY THE GUARDS ARE TESTED BEFORE THE HAPPY PATH ─────────────────
 * F8.4 established the pattern and the reason holds here: the failure mode of
 * a missing guard is silent. Nothing throws, no typecheck catches it, and the
 * screen looks entirely normal to the person who should not be seeing it.
 *
 * These writes are worse than a read, because each one decides where money is
 * attributed. A MANAGER who can open a branch can start routing revenue to a
 * shop the owner did not authorise, and `isDefault` decides where stock lands
 * when nothing names a branch.
 *
 * ─── THE CONTRACT ────────────────────────────────────────────────────
 * 1. Only OWNER/DEVELOPER may create or edit. `settings` access is NOT
 *    enough — MANAGER holds it and must still be refused.
 * 2. `Branch.code` is unique PER BUSINESS. A duplicate inside one business is
 *    a 409; the same code in a different business is fine.
 * 3. Exactly one branch per business carries `isDefault`.
 * 4. The last ACTIVE branch of a business cannot be deactivated.
 */

const app = createApp();

interface BusinessBody {
  data: { id: string; name: string; taxId: string | null };
}
interface BranchBody {
  data: { id: string; name: string; code: string | null; isDefault: boolean; isActive: boolean };
}

const RUN = `branchwrites-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SHORT = RUN.slice(-6);

const userIds: string[] = [];
const businessIds: string[] = [];

let ownerToken = '';
let managerToken = '';

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

/** A business created directly, for tests that are not about creating one. */
async function seedBusiness(label: string) {
  const business = await prisma.business.create({ data: { name: `${RUN} ${label}` } });
  businessIds.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const [owner, manager] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.MANAGER, 'manager'),
  ]);

  ownerToken = signToken(owner);
  managerToken = signToken(manager);
});

afterAll(async () => {
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('who may open a shop', () => {
  it('refuses a MANAGER creating a business, despite their `settings` access', async () => {
    // The whole point of the guard: reaching the settings PAGE does not imply
    // "may incorporate a company". If this ever passes, the route has been
    // moved back onto `requireArea('settings')`.
    const res = await request(app)
      .post('/api/v1/businesses')
      .set(auth(managerToken))
      .send({ name: `${RUN} manager attempt` });

    expect(res.status).toBe(403);
  });

  it('refuses a MANAGER creating a branch', async () => {
    const businessId = await seedBusiness('manager-branch-attempt');

    const res = await request(app)
      .post('/api/v1/branches')
      .set(auth(managerToken))
      .send({ businessId, name: `${RUN} manager branch` });

    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated create outright', async () => {
    const res = await request(app).post('/api/v1/businesses').send({ name: `${RUN} anon` });

    expect(res.status).toBe(401);
  });

  it('lets an OWNER create a business with nothing but a name', async () => {
    // An owner setting up their first business must not need a tax id before
    // they can add a product — every field but `name` is optional.
    const res = await request(app)
      .post('/api/v1/businesses')
      .set(auth(ownerToken))
      .send({ name: `${RUN} minimal` });

    expect(res.status).toBe(201);
    const body = res.body as BusinessBody;
    businessIds.push(body.data.id);

    expect(body.data.name).toBe(`${RUN} minimal`);
    expect(body.data.taxId).toBeNull();
  });

  it('still lets a MANAGER READ the org chart — only writes are owner-shaped', async () => {
    const res = await request(app).get('/api/v1/businesses').set(auth(managerToken));

    expect(res.status).toBe(200);
  });
});

describe('branch code is unique per business, not globally', () => {
  it('409s on a duplicate code inside one business', async () => {
    const businessId = await seedBusiness('dupe');

    const first = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} first`, code: `${SHORT}X` });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} second`, code: `${SHORT}X` });

    // A 500 here means P2002 reached the error handler untranslated, which
    // tells the owner nothing about which field to change.
    expect(second.status).toBe(409);
    expect((second.body as { error: { message: string } }).error.message).toMatch(/code/i);
  });

  it('accepts the SAME code in a different business', async () => {
    // Two businesses may both sensibly call a branch "MAIN". A global unique
    // constraint would make the second owner's setup fail for no reason.
    const [businessA, businessB] = await Promise.all([
      seedBusiness('shared-code-a'),
      seedBusiness('shared-code-b'),
    ]);

    const inA = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId: businessA, name: `${RUN} A`, code: `${SHORT}S` });
    const inB = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId: businessB, name: `${RUN} B`, code: `${SHORT}S` });

    expect(inA.status).toBe(201);
    expect(inB.status).toBe(201);
  });

  it('rejects a branch on a business that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId: 'no-such-business', name: `${RUN} orphan` });

    expect(res.status).toBe(400);
  });
});

describe('exactly one branch is the default', () => {
  it('makes the first branch of a business its default without being asked', async () => {
    // A business with branches and no default sends `defaultBranchId()` back
    // to "any active branch" — the ordering-dependent answer F8.2 removed.
    const businessId = await seedBusiness('first-default');

    const res = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} only` });

    expect((res.body as BranchBody).data.isDefault).toBe(true);
  });

  it('clears the previous default when a second branch claims it', async () => {
    const businessId = await seedBusiness('default-handover');

    const first = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} original default` });
    const second = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} new default`, isDefault: true });

    expect(second.status).toBe(201);

    const defaults = await prisma.branch.findMany({
      where: { businessId, isDefault: true },
      select: { id: true },
    });

    // Two defaults is the bug, not a preference: `defaultBranchId()` would
    // return whichever row the database handed back first.
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe((second.body as BranchBody).data.id);
    expect(defaults[0]!.id).not.toBe((first.body as BranchBody).data.id);
  });

  it('moves the flag on when the default branch is deactivated', async () => {
    const businessId = await seedBusiness('default-deactivated');

    const first = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} leaving` });
    await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} staying` });

    const res = await request(app)
      .patch(`/api/v1/branches/${(first.body as BranchBody).data.id}`)
      .set(auth(ownerToken))
      .send({ isActive: false });

    expect(res.status).toBe(200);

    // An inactive default is the same "nothing to fall back to" problem in a
    // quieter form, so the flag is handed to a branch that is still open.
    const defaults = await prisma.branch.findMany({
      where: { businessId, isDefault: true },
      select: { id: true, isActive: true },
    });

    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.isActive).toBe(true);
  });
});

describe('the last active branch cannot be deactivated', () => {
  it('refuses to close the only branch a business has', async () => {
    const businessId = await seedBusiness('last-branch');

    const only = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} the only one` });

    const res = await request(app)
      .patch(`/api/v1/branches/${(only.body as BranchBody).data.id}`)
      .set(auth(ownerToken))
      .send({ isActive: false });

    // Refused HERE, where the person can still understand why — rather than
    // at the point of sale, when a stock movement has no branch to record.
    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/last active/i);

    const after = await prisma.branch.findUniqueOrThrow({
      where: { id: (only.body as BranchBody).data.id },
      select: { isActive: true },
    });
    expect(after.isActive).toBe(true);
  });

  it('allows it once a second branch is open', async () => {
    const businessId = await seedBusiness('two-branches');

    const first = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} closing` });
    await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} remaining` });

    const res = await request(app)
      .patch(`/api/v1/branches/${(first.body as BranchBody).data.id}`)
      .set(auth(ownerToken))
      .send({ isActive: false });

    expect(res.status).toBe(200);
  });

  it('keeps a deactivated branch queryable — orders are history', async () => {
    // Deactivating is not deleting. The row, its stock and its orders survive,
    // because a closed shop's numbers still explain last year's revenue.
    const businessId = await seedBusiness('history-survives');

    const closing = await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} closed shop` });
    await request(app)
      .post('/api/v1/branches')
      .set(auth(ownerToken))
      .send({ businessId, name: `${RUN} open shop` });

    await request(app)
      .patch(`/api/v1/branches/${(closing.body as BranchBody).data.id}`)
      .set(auth(ownerToken))
      .send({ isActive: false });

    const still = await prisma.branch.findUnique({
      where: { id: (closing.body as BranchBody).data.id },
    });

    expect(still).not.toBeNull();
    expect(still!.name).toBe(`${RUN} closed shop`);
  });
});

describe('editing a business', () => {
  it('never reassigns the row when a client echoes `id` back', async () => {
    const businessId = await seedBusiness('id-echo');
    const other = await seedBusiness('id-echo-other');

    const res = await request(app)
      .patch(`/api/v1/businesses/${businessId}`)
      .set(auth(ownerToken))
      .send({ id: other, name: `${RUN} renamed` });

    expect(res.status).toBe(200);
    // `id` is not in the schema, so it is dropped rather than applied.
    expect((res.body as BusinessBody).data.id).toBe(businessId);
    expect((res.body as BusinessBody).data.name).toBe(`${RUN} renamed`);
  });

  it('404s on a business that does not exist', async () => {
    const res = await request(app)
      .patch('/api/v1/businesses/no-such-business')
      .set(auth(ownerToken))
      .send({ name: `${RUN} ghost` });

    expect(res.status).toBe(404);
  });

  it('refuses a MANAGER editing one', async () => {
    const businessId = await seedBusiness('manager-edit');

    const res = await request(app)
      .patch(`/api/v1/businesses/${businessId}`)
      .set(auth(managerToken))
      .send({ name: `${RUN} manager rename` });

    expect(res.status).toBe(403);
  });
});
