import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Staff accounts — the most security-sensitive screen in the app.
 *
 * These tests are almost entirely about what must NOT be possible. A staff
 * list that renders correctly but lets a manager make themselves an owner is
 * worse than no staff screen at all, and no amount of UI polish shows it.
 *
 * The four rules:
 *   1. Nobody grants a role above their own rank.
 *   2. Nobody changes their own role.
 *   3. Nobody modifies someone who outranks them.
 *   4. The last active owner cannot be removed.
 */

const app = createApp();

interface StaffBody {
  data: { staff: Record<string, unknown> };
}
interface ListBody {
  data: { staff: { id: string; email: string }[]; total: number };
}
interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const RUN = `stafftest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let ownerToken = '';
let ownerId = '';
let secondOwnerId = '';
let managerToken = '';
let supportId = '';

async function makeUser(role: StaffRole, tag = role.toLowerCase()) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      name: `${RUN} ${tag}`,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return { id: user.id, token: signToken(user) };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function patch(id: string, body: Record<string, unknown>, token = ownerToken) {
  return request(app).patch(`/api/v1/staff/${id}`).set(auth(token)).send(body);
}

beforeAll(async () => {
  const owner = await makeUser(StaffRole.OWNER, 'owner');
  const secondOwner = await makeUser(StaffRole.OWNER, 'owner2');
  const manager = await makeUser(StaffRole.MANAGER, 'manager');
  const support = await makeUser(StaffRole.SUPPORT, 'support');

  ownerToken = owner.token;
  ownerId = owner.id;
  secondOwnerId = secondOwner.id;
  managerToken = manager.token;
  supportId = support.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('who can reach the staff area at all', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get('/api/v1/staff')).status).toBe(401);
  });

  it('denies a MANAGER — hiring stays with the owner', async () => {
    // MANAGER reaches every other area. Staff is the deliberate exception.
    expect((await request(app).get('/api/v1/staff').set(auth(managerToken))).status).toBe(403);
  });

  it('allows an OWNER', async () => {
    expect((await request(app).get('/api/v1/staff').set(auth(ownerToken))).status).toBe(200);
  });
});

describe('the engine cannot reach users', () => {
  it('404s /r/users', async () => {
    // `users` is absent from admin.config.ts on purpose: the engine's select is
    // built from a field list, and one careless entry would expose passwordHash.
    expect((await request(app).get('/api/v1/r/users').set(auth(ownerToken))).status).toBe(404);
  });
});

describe('passwordHash never leaves the server', () => {
  it('is absent from the list', async () => {
    const res = await request(app)
      .get(`/api/v1/staff?search=${RUN}&pageSize=100`)
      .set(auth(ownerToken));

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });

  it('is absent from a create response', async () => {
    const res = await request(app)
      .post('/api/v1/staff')
      .set(auth(ownerToken))
      .send({
        email: `${RUN}-new@example.test`,
        name: 'New Person',
        role: StaffRole.SUPPORT,
        password: 'a-sufficiently-long-password',
      });

    expect(res.status).toBe(201);
    userIds.push(String((res.body as StaffBody).data.staff.id));
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('rule 1 — nobody grants a role above their own rank', () => {
  it('refuses to create someone more privileged than the creator', async () => {
    /**
     * The classic escalation: a lower-ranked admin creates an account one step
     * up and signs into it. Enforced in the SERVICE, so a second caller added
     * later cannot bypass it.
     */
    const support = await makeUser(StaffRole.SUPPORT, 'escalator');

    // Support cannot reach the area at all, so use an OWNER creating a
    // DEVELOPER — the only rank above OWNER.
    const res = await request(app)
      .post('/api/v1/staff')
      .set(auth(ownerToken))
      .send({
        email: `${RUN}-dev@example.test`,
        role: StaffRole.DEVELOPER,
        password: 'a-sufficiently-long-password',
      });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.details).toMatchObject({ field: 'role' });
    expect(support.id).toBeTruthy();
  });

  it('refuses to PROMOTE someone above the actor', async () => {
    const res = await patch(supportId, { role: StaffRole.DEVELOPER });

    expect(res.status).toBe(403);

    const after = await prisma.user.findUnique({ where: { id: supportId } });
    expect(after?.role).toBe(StaffRole.SUPPORT);
  });

  it('allows granting a role at or below the actor', async () => {
    // An OWNER creating another OWNER must work — otherwise only a DEVELOPER
    // could, and one deleted account leaves nobody able to hire.
    const res = await patch(supportId, { role: StaffRole.MANAGER });

    expect(res.status).toBe(200);
    expect((res.body as StaffBody).data.staff.role).toBe(StaffRole.MANAGER);

    await patch(supportId, { role: StaffRole.SUPPORT });
  });
});

describe('rule 2 — nobody changes their own role', () => {
  it('refuses self-promotion', async () => {
    const res = await patch(ownerId, { role: StaffRole.DEVELOPER });

    expect(res.status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: ownerId } }))?.role).toBe(
      StaffRole.OWNER,
    );
  });

  it('refuses self-DEMOTION too', async () => {
    // Blocked in both directions: a self-demotion that removes the last owner
    // is a lockout, and there is no legitimate reason to demote yourself
    // rather than have a peer do it.
    const res = await patch(ownerId, { role: StaffRole.SUPPORT });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.details).toMatchObject({ field: 'role' });
  });

  it('refuses self-deactivation', async () => {
    const res = await patch(ownerId, { isActive: false });

    expect(res.status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: ownerId } }))?.isActive).toBe(true);
  });

  it('still allows editing your own name', async () => {
    // Only ROLE and ACTIVE are restricted — the rest is ordinary profile data.
    const res = await patch(ownerId, { name: `${RUN} owner renamed` });

    expect(res.status).toBe(200);
  });
});

describe('rule 3 — nobody modifies someone who outranks them', () => {
  it('refuses to touch a more privileged account', async () => {
    const developer = await makeUser(StaffRole.DEVELOPER, 'dev-superior');

    const res = await patch(developer.id, { name: 'renamed by an owner' });

    expect(res.status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: developer.id } }))?.name).not.toBe(
      'renamed by an owner',
    );
  });

  it('allows peers to manage each other', async () => {
    // Equal rank is not outranking — two owners must be able to help each other.
    const res = await patch(secondOwnerId, { name: `${RUN} peer edit` });

    expect(res.status).toBe(200);
  });
});

describe('rule 4 — the last active owner cannot be removed', () => {
  /**
   * Leaves EXACTLY ONE active owner — `ownerId` — for the duration.
   *
   * The first version only parked our own second owner and assumed those were
   * the only two. The database also holds the seeded admin, so two owners
   * stayed active, the guard correctly did not fire, and the demotion
   * SUCCEEDED — which then broke every later test, because the token they
   * shared belonged to an account that was no longer an owner.
   *
   * Now it parks every other active owner and restores exactly those, so the
   * precondition is real and shared data is left as it was found.
   */
  async function withOnlyOneOwner<T>(run: () => Promise<T>): Promise<T> {
    const others = await prisma.user.findMany({
      where: { role: StaffRole.OWNER, isActive: true, id: { not: ownerId } },
      select: { id: true },
    });

    const parked = others.map((user) => user.id);

    await prisma.user.updateMany({
      where: { id: { in: parked } },
      data: { isActive: false },
    });

    try {
      return await run();
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: parked } },
        data: { isActive: true },
      });
      // Belt and braces: if a guard ever fails to hold, restore the role too
      // rather than leaving the suite's own owner demoted.
      await prisma.user.update({
        where: { id: ownerId },
        data: { role: StaffRole.OWNER, isActive: true },
      });
    }
  }

  it('refuses to demote the last one', async () => {
    /**
     * The lockout. Nobody would then be able to reach the staff area, and
     * recovery needs direct database access — the exact situation the roadmap
     * lists as an open risk for password reset.
     */
    await withOnlyOneOwner(async () => {
      const developer = await makeUser(StaffRole.DEVELOPER, 'dev-rescuer');

      const res = await request(app)
        .patch(`/api/v1/staff/${ownerId}`)
        .set(auth(developer.token))
        .send({ role: StaffRole.MANAGER });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.message).toMatch(/last active owner/i);
    });
  });

  it('refuses to deactivate the last one', async () => {
    await withOnlyOneOwner(async () => {
      const developer = await makeUser(StaffRole.DEVELOPER, 'dev-rescuer2');

      const res = await request(app)
        .patch(`/api/v1/staff/${ownerId}`)
        .set(auth(developer.token))
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect((await prisma.user.findUnique({ where: { id: ownerId } }))?.isActive).toBe(true);
    });
  });

  it('allows it once another owner is active', async () => {
    const developer = await makeUser(StaffRole.DEVELOPER, 'dev-rescuer3');

    const res = await request(app)
      .patch(`/api/v1/staff/${secondOwnerId}`)
      .set(auth(developer.token))
      .send({ isActive: false });

    expect(res.status).toBe(200);

    await prisma.user.update({ where: { id: secondOwnerId }, data: { isActive: true } });
  });
});

describe('there is no delete route', () => {
  it('404s a DELETE', async () => {
    // Deactivation preserves the audit trail. A deleted account takes with it
    // the answer to "who approved this in March".
    const res = await request(app).delete(`/api/v1/staff/${supportId}`).set(auth(ownerToken));

    expect(res.status).toBe(404);
    expect(await prisma.user.findUnique({ where: { id: supportId } })).not.toBeNull();
  });
});

describe('operational actions', () => {
  it('clears a brute-force lockout', async () => {
    await prisma.user.update({
      where: { id: supportId },
      data: { lockedUntil: new Date(Date.now() + 900_000), failedLoginAttempts: 5 },
    });

    const res = await request(app)
      .post(`/api/v1/staff/${supportId}/unlock`)
      .set(auth(ownerToken));

    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: supportId } });
    expect(after?.lockedUntil).toBeNull();
    expect(after?.failedLoginAttempts).toBe(0);
  });

  it('surfaces WHY someone cannot sign in', async () => {
    // Otherwise an admin resets a password that was never the problem.
    await prisma.user.update({
      where: { id: supportId },
      data: { lockedUntil: new Date(Date.now() + 900_000) },
    });

    const res = await request(app)
      .get(`/api/v1/staff?search=${RUN}&pageSize=100`)
      .set(auth(ownerToken));

    const row = (res.body as ListBody).data.staff.find((s) => s.id === supportId) as
      | { lockedUntil: string | null }
      | undefined;

    expect(row?.lockedUntil).not.toBeNull();

    await prisma.user.update({ where: { id: supportId }, data: { lockedUntil: null } });
  });

  it('resets a password and clears the lockout with it', async () => {
    // The credential being guessed no longer exists, so the lock is moot.
    await prisma.user.update({
      where: { id: supportId },
      data: { lockedUntil: new Date(Date.now() + 900_000), failedLoginAttempts: 5 },
    });

    const res = await request(app)
      .post(`/api/v1/staff/${supportId}/password`)
      .set(auth(ownerToken))
      .send({ password: 'another-sufficiently-long-password' });

    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: supportId } });
    expect(after?.lockedUntil).toBeNull();
    expect(
      await bcrypt.compare('another-sufficiently-long-password', after?.passwordHash ?? ''),
    ).toBe(true);
  });

  it('rejects a short password', async () => {
    // Set BY an admin FOR someone else, so it is typed once and rarely
    // changed — it cannot rely on the owner choosing well.
    const res = await request(app)
      .post(`/api/v1/staff/${supportId}/password`)
      .set(auth(ownerToken))
      .send({ password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('input validation', () => {
  it('rejects a duplicate email with 409, not a 500', async () => {
    const res = await request(app)
      .post('/api/v1/staff')
      .set(auth(ownerToken))
      .send({
        email: `${RUN}-owner@example.test`,
        role: StaffRole.SUPPORT,
        password: 'a-sufficiently-long-password',
      });

    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.details).toMatchObject({ field: 'email' });
  });

  it('rejects an unknown field', async () => {
    // .strict() — the whole point on a route that assigns privilege.
    const res = await request(app)
      .post('/api/v1/staff')
      .set(auth(ownerToken))
      .send({
        email: `${RUN}-x@example.test`,
        role: StaffRole.SUPPORT,
        password: 'a-sufficiently-long-password',
        passwordHash: 'injected',
      });

    expect(res.status).toBe(400);
  });

  it('404s an unknown staff member', async () => {
    expect((await patch('nope', { name: 'x' })).status).toBe(404);
  });
});
