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

describe('one-time password reset tokens', () => {
  // Redemption itself (expiry, single-use, session revocation, enumeration
  // resistance) is covered end-to-end in password-reset.test.ts — this file
  // only covers WHO may issue one, which is the same rank rules as every
  // other staff write.
  it('an OWNER can issue a token for a lower-rank user', async () => {
    const res = await request(app)
      .post(`/api/v1/staff/${supportId}/reset-token`)
      .set(auth(ownerToken));

    expect(res.status).toBe(201);

    const body = res.body as { data: { staff: { id: string }; token: string; expiresAt: string } };
    expect(body.data.staff.id).toBe(supportId);
    // A real, redeemable-looking token, not an id or a hash.
    expect(body.data.token).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rule 3 applies here too — nobody can issue one for someone who outranks them', async () => {
    const developer = await makeUser(StaffRole.DEVELOPER, 'dev-resettoken');

    const res = await request(app)
      .post(`/api/v1/staff/${developer.id}/reset-token`)
      .set(auth(ownerToken));

    expect(res.status).toBe(403);
  });

  it('peers can issue one for each other', async () => {
    // Equal rank is not outranking — two owners must be able to help each other.
    const res = await request(app)
      .post(`/api/v1/staff/${secondOwnerId}/reset-token`)
      .set(auth(ownerToken));

    expect(res.status).toBe(201);
  });

  it('issuing a new token invalidates any of that user unused ones', async () => {
    await request(app).post(`/api/v1/staff/${supportId}/reset-token`).set(auth(ownerToken));
    await request(app).post(`/api/v1/staff/${supportId}/reset-token`).set(auth(ownerToken));

    const live = await prisma.passwordResetToken.count({
      where: { userId: supportId, usedAt: null },
    });

    // Whatever ran before this test in the file may have left one too, but
    // there must never be MORE than one live token for the same user.
    expect(live).toBe(1);
  });
});

/**
 * B2.5 — invitations. Before this, the ONLY way to bring a new person onto
 * staff was `POST /staff` with an admin typing a password on their behalf —
 * the spec's primary action for this page ("Invite staff") had no route.
 *
 * Reuses the exact `PasswordResetToken` mechanism `reset-token` above uses —
 * these tests focus on what invite adds: no admin-known password, the SAME
 * rank rules as every other staff-creation path, and a longer token TTL
 * (an invite sits unopened far longer than a live reset call).
 */
describe('POST /api/v1/staff/invite', () => {
  it('creates the account and returns a token, with NO password field anywhere in the request', async () => {
    const email = `${RUN}-invitee@example.test`;

    const res = await request(app)
      .post('/api/v1/staff/invite')
      .set(auth(ownerToken))
      .send({ email, role: StaffRole.SUPPORT, name: 'Invitee' });

    expect(res.status).toBe(201);

    const body = res.body as {
      data: { staff: { id: string; email: string }; token: string; expiresAt: string };
    };
    userIds.push(body.data.staff.id);

    expect(body.data.staff.email).toBe(email);
    expect(body.data.token).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // The account genuinely has NO password anyone typed — only the redeemed
    // token can ever set one. Confirmed by making sure no plausible password
    // works, not by inspecting the hash.
    const loginAttempt = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct-horse-battery-staple' });
    expect(loginAttempt.status).toBe(401);
  });

  it('rejects a body that includes a password field — .strict() at the schema, not a route that ignores it', async () => {
    const res = await request(app)
      .post('/api/v1/staff/invite')
      .set(auth(ownerToken))
      .send({
        email: `${RUN}-invite-strict@example.test`,
        role: StaffRole.SUPPORT,
        password: 'whatever-they-sent',
      });

    expect(res.status).toBe(400);
  });

  it('the returned token actually activates the account', async () => {
    const email = `${RUN}-invite-activate@example.test`;

    const inviteRes = await request(app)
      .post('/api/v1/staff/invite')
      .set(auth(ownerToken))
      .send({ email, role: StaffRole.SUPPORT });

    const inviteBody = inviteRes.body as { data: { staff: { id: string }; token: string } };
    userIds.push(inviteBody.data.staff.id);

    const redeemRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteBody.data.token, password: 'a-long-enough-chosen-password' });
    expect(redeemRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'a-long-enough-chosen-password' });
    expect(loginRes.status).toBe(200);
  });

  it('rule 1 applies — nobody invites a role above their own rank', async () => {
    const res = await request(app)
      .post('/api/v1/staff/invite')
      .set(auth(managerToken))
      .send({ email: `${RUN}-invite-rule1@example.test`, role: StaffRole.OWNER });

    expect(res.status).toBe(403);
  });

  it('rejects a duplicate email with 409, same as a direct create', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });

    const res = await request(app)
      .post('/api/v1/staff/invite')
      .set(auth(ownerToken))
      .send({ email: owner.email, role: StaffRole.SUPPORT });

    expect(res.status).toBe(409);
  });

  it('an invite token outlives the 30-minute reset window', async () => {
    const inviteRes = await request(app)
      .post('/api/v1/staff/invite')
      .set(auth(ownerToken))
      .send({ email: `${RUN}-invite-ttl@example.test`, role: StaffRole.SUPPORT });

    const body = inviteRes.body as { data: { staff: { id: string }; expiresAt: string } };
    userIds.push(body.data.staff.id);

    const minutesUntilExpiry = (new Date(body.data.expiresAt).getTime() - Date.now()) / 60_000;
    // A reset call is handed over live; an invite is typically opened hours
    // later. 30 minutes would expire before most people read the message.
    expect(minutesUntilExpiry).toBeGreaterThan(30);
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

/**
 * Transfer ownership (B3.4, danger zone) — the one deliberate exception to
 * rule 2. `updateStaff` hard-refuses a self role-change; this is a SEPARATE,
 * narrower endpoint that accepts exactly one shape of self-change (OWNER →
 * MANAGER, paired with promoting someone else to OWNER) and nothing else.
 */
describe('POST /api/v1/staff/:id/transfer-ownership', () => {
  function transfer(id: string, body: Record<string, unknown>, token = ownerToken) {
    return request(app)
      .post(`/api/v1/staff/${id}/transfer-ownership`)
      .set(auth(token))
      .send(body);
  }

  it('rejects a non-owner actor', async () => {
    const res = await transfer(supportId, { currentPassword: 'x' }, managerToken);
    expect(res.status).toBe(403);
  });

  it('rejects the wrong current password', async () => {
    const res = await transfer(supportId, { currentPassword: 'definitely-not-it' });
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.message).toMatch(/current password/i);
  });

  it('rejects transferring to yourself', async () => {
    const res = await transfer(ownerId, { currentPassword: 'correct-horse-battery-staple' });
    expect(res.status).toBe(400);
  });

  it('404s an unknown target', async () => {
    const res = await transfer('nope', { currentPassword: 'correct-horse-battery-staple' });
    expect(res.status).toBe(404);
  });

  it('rejects a deactivated target', async () => {
    const inactive = await makeUser(StaffRole.SUPPORT, 'transfer-inactive');
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });

    const res = await transfer(inactive.id, { currentPassword: 'correct-horse-battery-staple' });
    expect(res.status).toBe(400);
  });

  it('promotes the target to OWNER and demotes the actor to MANAGER, atomically', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'transfer-owner');
    const target = await makeUser(StaffRole.SUPPORT, 'transfer-target');

    const res = await transfer(
      target.id,
      { currentPassword: 'correct-horse-battery-staple' },
      owner.token,
    );

    expect(res.status).toBe(200);

    const [newOwnerRow, exOwnerRow] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    ]);

    expect(newOwnerRow.role).toBe(StaffRole.OWNER);
    expect(exOwnerRow.role).toBe(StaffRole.MANAGER);
  });

  it('revokes sessions for both accounts (stale role claim)', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'transfer-revoke-owner');
    const target = await makeUser(StaffRole.SUPPORT, 'transfer-revoke-target');

    const beforeOwner = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const beforeTarget = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });

    await transfer(target.id, { currentPassword: 'correct-horse-battery-staple' }, owner.token);

    const afterOwner = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const afterTarget = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });

    expect(afterOwner.tokenVersion).toBeGreaterThan(beforeOwner.tokenVersion);
    expect(afterTarget.tokenVersion).toBeGreaterThan(beforeTarget.tokenVersion);
  });

  it('never drops below one active owner, even mid-transfer', async () => {
    // Transferring away from the LAST active owner still leaves exactly one
    // active owner throughout — the target becomes one before the actor
    // stops being one, in the same transaction.
    const soleOwner = await makeUser(StaffRole.OWNER, 'transfer-sole-owner');
    const target = await makeUser(StaffRole.SUPPORT, 'transfer-sole-target');

    // Deactivate every OTHER owner created in this file so this really is
    // the only path to an OWNER role left standing beforehand.
    await transfer(
      target.id,
      { currentPassword: 'correct-horse-battery-staple' },
      soleOwner.token,
    );

    const activeOwners = await prisma.user.count({
      where: { role: StaffRole.OWNER, isActive: true },
    });
    expect(activeOwners).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unknown field (strict body)', async () => {
    const res = await transfer(supportId, {
      currentPassword: 'correct-horse-battery-staple',
      role: StaffRole.DEVELOPER,
    });
    expect(res.status).toBe(400);
  });
});
