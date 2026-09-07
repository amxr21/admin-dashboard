import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { resolveRoleAtBranch } from '../services/branch-roles.service.js';

/**
 * Putting people at branches (O7 stage 2).
 *
 * ─── WHY THE STAFF RULES ARE THE POINT OF THIS FILE ──────────────────
 * `staff.service.ts` enforces four rules on every global role change. A
 * per-branch grant that skipped them would not be a smaller version of the
 * same feature — it would be an escalation path AROUND the global rules,
 * reachable by anyone who could open a roster.
 *
 * So the assertions below are mostly refusals. Each one is a way somebody
 * could otherwise end up with access nobody granted them:
 *
 * 1. Granting above your own rank      -> escalation by proxy
 * 2. Editing your own row              -> self-promotion, quieter than the
 *                                         global kind but identical in effect
 * 3. Touching someone who outranks you -> lateral attack
 * 4. OWNER/DEVELOPER as a branch role  -> a write that silently does nothing,
 *                                         because the resolver ignores it
 *
 * The last one matters more than it looks: accepting the row would show the
 * owner a grant on screen that has no effect anywhere.
 */

const app = createApp();

interface RosterRow {
  userId: string;
  role: StaffRole;
  globalRole: StaffRole;
}

const RUN = `roster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
const businessIds: string[] = [];

let marina = '';
let downtown = '';

let ownerToken = '';
let managerToken = '';
let ownerId = '';
let supportId = '';
let fulfillmentId = '';
let secondOwnerId = '';

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

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessIds.push(business.id);

  const [a, b] = await Promise.all([
    prisma.branch.create({
      data: { businessId: business.id, name: `${RUN} Marina`, isDefault: true },
    }),
    prisma.branch.create({ data: { businessId: business.id, name: `${RUN} Downtown` } }),
  ]);
  marina = a.id;
  downtown = b.id;

  const [owner, manager, support, fulfillment, secondOwner] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.MANAGER, 'manager'),
    makeUser(StaffRole.SUPPORT, 'support'),
    makeUser(StaffRole.FULFILLMENT, 'fulfillment'),
    makeUser(StaffRole.OWNER, 'second-owner'),
  ]);

  ownerId = owner.id;
  supportId = support.id;
  fulfillmentId = fulfillment.id;
  secondOwnerId = secondOwner.id;

  ownerToken = signToken(owner);
  managerToken = signToken(manager);
});

afterAll(async () => {
  await prisma.userBranch.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('the four staff rules apply to a branch grant', () => {
  it('refuses a grant above the actor own rank', async () => {
    // A MANAGER cannot reach this route at all (guard below), so rank is
    // tested where it bites: an OWNER may grant MANAGER, but nobody may grant
    // a role the rules treat as above them. DEVELOPER outranks OWNER.
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: supportId, role: StaffRole.DEVELOPER });

    expect(res.status).toBe(403);
  });

  it('refuses somebody assigning themselves', async () => {
    // Self-promotion at a branch is the same act as the global kind, just
    // quieter — and this route is reachable only by people senior enough for
    // it to be worth attempting.
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: ownerId, role: StaffRole.MANAGER });

    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/your own/i);
  });

  it('refuses touching someone who outranks the actor', async () => {
    // An OWNER acting on another OWNER is EQUAL rank, which the global rules
    // allow (peers manage each other). So this asserts the boundary the rules
    // actually draw, using the role that does outrank one.
    const developer = await makeUser(StaffRole.DEVELOPER, 'developer-subject');

    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: developer.id, role: StaffRole.MANAGER });

    expect(res.status).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/more access/i);
  });

  it('refuses OWNER or DEVELOPER as a branch role', async () => {
    // `resolveRoleAtBranch` short-circuits on business-wide roles before it
    // reads this table, so such a row would do nothing at all. Refusing beats
    // accepting: an owner must not see a grant on screen that has no effect.
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: supportId, role: StaffRole.OWNER });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/whole business/i);
  });

  it('refuses a MANAGER reaching the roster at all', async () => {
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(managerToken))
      .send({ userId: supportId, role: StaffRole.FULFILLMENT });

    expect(res.status).toBe(403);
  });

  it('leaves an equal-rank peer alone as the global rules do', async () => {
    // Not an escalation: equal rank is explicitly allowed globally, and this
    // asserts the branch path did not accidentally become STRICTER than the
    // rules it mirrors. It is refused for a different reason — OWNER is not a
    // grantable branch role — which is the 400 above, not a 403.
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: secondOwnerId, role: StaffRole.OWNER });

    expect(res.status).toBe(400);
  });
});

describe('assigning and removing', () => {
  it('places somebody at a branch and resolves their role there', async () => {
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: supportId, role: StaffRole.MANAGER });

    expect(res.status).toBe(201);

    // The write path has to produce what F8.4's read path already promised.
    expect(await resolveRoleAtBranch(supportId, marina)).toBe(StaffRole.MANAGER);
  });

  it('upserts on re-assignment rather than failing', async () => {
    await request(app)
      .post(`/api/v1/branches/${downtown}/staff`)
      .set(auth(ownerToken))
      .send({ userId: fulfillmentId, role: StaffRole.SUPPORT });

    const again = await request(app)
      .post(`/api/v1/branches/${downtown}/staff`)
      .set(auth(ownerToken))
      .send({ userId: fulfillmentId, role: StaffRole.MANAGER });

    // 200 not 201: this changed an existing placement rather than creating one.
    expect(again.status).toBe(200);
    expect(await resolveRoleAtBranch(fulfillmentId, downtown)).toBe(StaffRole.MANAGER);

    const rows = await prisma.userBranch.count({
      where: { userId: fulfillmentId, branchId: downtown },
    });
    expect(rows).toBe(1);
  });

  it('a role at one branch does not change it at another', async () => {
    // F8.4's central contract, now exercised through the WRITE path — the
    // read path was already tested, but nothing could create a row to test it
    // with until this stage.
    await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: fulfillmentId, role: StaffRole.SUPPORT });

    expect(await resolveRoleAtBranch(fulfillmentId, marina)).toBe(StaffRole.SUPPORT);
    expect(await resolveRoleAtBranch(fulfillmentId, downtown)).toBe(StaffRole.MANAGER);

    // And unscoped stays the global role, untouched by either.
    expect(await resolveRoleAtBranch(fulfillmentId, null)).toBe(StaffRole.FULFILLMENT);
  });

  it('removal keeps the global role', async () => {
    const target = await makeUser(StaffRole.SUPPORT, 'removable');

    await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: target.id, role: StaffRole.MANAGER });

    const res = await request(app)
      .delete(`/api/v1/branches/${marina}/staff/${target.id}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(204);

    // No row means "no longer placed here", never "demoted" — the fallback is
    // the global role, exactly as for someone never assigned.
    expect(await resolveRoleAtBranch(target.id, marina)).toBe(StaffRole.SUPPORT);
  });

  it('404s removing somebody who is not on the roster', async () => {
    const res = await request(app)
      .delete(`/api/v1/branches/${downtown}/staff/${supportId}`)
      .set(auth(ownerToken));

    expect(res.status).toBe(404);
  });

  it('404s assigning to a branch that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/branches/no-such-branch/staff')
      .set(auth(ownerToken))
      .send({ userId: supportId, role: StaffRole.MANAGER });

    expect(res.status).toBe(404);
  });

  it('404s assigning somebody who does not exist', async () => {
    const res = await request(app)
      .post(`/api/v1/branches/${marina}/staff`)
      .set(auth(ownerToken))
      .send({ userId: 'no-such-user', role: StaffRole.MANAGER });

    expect(res.status).toBe(404);
  });
});

describe('the roster read', () => {
  it('shows the branch role and the global role separately', async () => {
    // Showing only the branch role would make a SUPPORT-globally /
    // MANAGER-here person read as a manager outright — the confusion F8.4's
    // replacement rule exists to avoid.
    const target = await makeUser(StaffRole.SUPPORT, 'roster-read');

    await request(app)
      .post(`/api/v1/branches/${downtown}/staff`)
      .set(auth(ownerToken))
      .send({ userId: target.id, role: StaffRole.MANAGER });

    const res = await request(app)
      .get(`/api/v1/branches/${downtown}/staff`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);

    const row = (res.body as { data: RosterRow[] }).data.find((r) => r.userId === target.id);

    expect(row).toBeDefined();
    expect(row!.role).toBe(StaffRole.MANAGER);
    expect(row!.globalRole).toBe(StaffRole.SUPPORT);
  });

  it('lets a MANAGER read a roster even though they cannot change it', async () => {
    const res = await request(app)
      .get(`/api/v1/branches/${marina}/staff`)
      .set(auth(managerToken));

    expect(res.status).toBe(200);
  });
});
