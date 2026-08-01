import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Token revocation and the audit trail — the two items that gate dev → main.
 *
 * Revocation is the one where a passing test is the ONLY proof: a revoked
 * token still has a valid signature and an unexpired claim, so nothing about
 * it looks wrong. The only way to know it stopped working is to try it.
 */

const app = createApp();

const RUN = `revtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
let ownerToken = '';
let ownerId = '';

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
  return { id: user.id, token: signToken(user), user };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  const owner = await makeUser(StaffRole.OWNER, 'owner');
  ownerToken = owner.token;
  ownerId = owner.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('a token works until it is revoked', () => {
  it('accepts a freshly issued token', async () => {
    const subject = await makeUser(StaffRole.SUPPORT, 'valid');

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(200);
  });

  it('rejects it the moment the version is bumped', async () => {
    /**
     * The proof. The token's signature is still valid and it has not expired —
     * nothing about it looks wrong. Only the version comparison stops it.
     */
    const subject = await makeUser(StaffRole.SUPPORT, 'revoked');

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(200);

    await prisma.user.update({
      where: { id: subject.id },
      data: { tokenVersion: { increment: 1 } },
    });

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(401);
  });

  it('still accepts a legacy token that carries no version', async () => {
    // Tokens minted before this feature existed have no `tv`. Rejecting them
    // would sign every user out on deploy — the wrong trade for a capability
    // nobody has needed yet.
    const subject = await makeUser(StaffRole.SUPPORT, 'legacy');
    const legacy = signToken({
      id: subject.id,
      role: StaffRole.SUPPORT,
      tokenVersion: undefined as unknown as number,
    });

    expect((await request(app).get('/api/v1/orders').set(auth(legacy))).status).toBe(200);
  });
});

describe('the actions that MUST revoke', () => {
  it('a password reset logs the person out everywhere', async () => {
    // Otherwise "I reset their password" does not lock out whoever has their
    // laptop — the old token lives for up to seven days.
    const subject = await makeUser(StaffRole.SUPPORT, 'pwreset');

    await request(app)
      .post(`/api/v1/staff/${subject.id}/password`)
      .set(auth(ownerToken))
      .send({ password: 'a-sufficiently-long-password' });

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(401);
  });

  it('deactivation kills the token, not just the next request', async () => {
    const subject = await makeUser(StaffRole.SUPPORT, 'deactivated');

    await request(app)
      .patch(`/api/v1/staff/${subject.id}`)
      .set(auth(ownerToken))
      .send({ isActive: false });

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(401);

    const after = await prisma.user.findUnique({ where: { id: subject.id } });
    expect(after?.tokenVersion).toBeGreaterThan(0);
  });

  it('a role change revokes, because the old token carries the old role', async () => {
    // Anything reading the role from the token rather than the row would keep
    // honouring privileges that were just taken away.
    const subject = await makeUser(StaffRole.MANAGER, 'demoted');

    await request(app)
      .patch(`/api/v1/staff/${subject.id}`)
      .set(auth(ownerToken))
      .send({ role: StaffRole.SUPPORT });

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(401);
  });

  it('an ordinary edit does NOT revoke', async () => {
    // Renaming someone must not sign them out — a revocation that fires on
    // every save teaches people to avoid editing.
    const subject = await makeUser(StaffRole.SUPPORT, 'renamed');

    await request(app)
      .patch(`/api/v1/staff/${subject.id}`)
      .set(auth(ownerToken))
      .send({ name: 'New Name' });

    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(200);
  });
});

describe('the audit trail', () => {
  it('is readable by staff-area roles only', async () => {
    const support = await makeUser(StaffRole.SUPPORT, 'auditreader');

    expect((await request(app).get('/api/v1/audit').set(auth(support.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/audit').set(auth(ownerToken))).status).toBe(200);
  });

  it('exposes no way to write, edit or delete an entry', async () => {
    // A trail that can be edited is not evidence.
    for (const method of ['post', 'patch', 'delete'] as const) {
      const res = await request(app)[method]('/api/v1/audit').set(auth(ownerToken)).send({});
      expect(res.status).toBe(404);
    }
  });

  it('redacts credentials rather than omitting the fact they changed', async () => {
    const { audit } = await import('../services/audit.service.js');

    // A minimal fake request — the service only reads user, log and requestId.
    const fakeReq = {
      user: { id: ownerId, email: 'x@example.test', role: StaffRole.OWNER },
      requestId: 'test-request',
      log: { error: () => undefined },
    } as never;

    audit(fakeReq, {
      action: 'staff.password.reset',
      entity: 'user',
      entityId: ownerId,
      changes: { passwordHash: 'super-secret-hash', name: { from: 'A', to: 'B' } },
    });

    // Fire-and-forget by design, so give the write a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const entry = await prisma.auditLog.findFirst({
      where: { actorId: ownerId, action: 'staff.password.reset' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry).not.toBeNull();

    const changes = JSON.stringify(entry?.changes);
    expect(changes).not.toContain('super-secret-hash');
    expect(changes).toContain('[redacted]');
    // The FACT of the change survives — that is the part worth keeping.
    expect(changes).toContain('passwordHash');
  });

  it('records the actor email so the trail survives the account', async () => {
    const entry = await prisma.auditLog.findFirst({ where: { actorId: ownerId } });

    // Denormalised on purpose: an audit row naming a deleted user id is still
    // evidence, but only if it also says who that was.
    expect(entry?.actorEmail).toBeTruthy();
    expect(entry?.actorRole).toBe(StaffRole.OWNER);
  });

  it('produces no entry when nothing actually changed', async () => {
    const { diff } = await import('../services/audit.service.js');

    expect(diff({ name: 'A', role: 'OWNER' }, { name: 'A', role: 'OWNER' })).toEqual({});
    expect(diff({ name: 'A' }, { name: 'B' })).toEqual({ name: { from: 'A', to: 'B' } });
  });

  it('narrows by inclusive calendar-date range', async () => {
    const entry = await prisma.auditLog.create({
      data: {
        action: 'test.date-range',
        entity: 'audit-test-entity',
        actorId: ownerId,
        createdAt: new Date('2020-01-15T12:00:00.000Z'),
      },
    });

    try {
      const inRange = await request(app)
        .get('/api/v1/audit')
        .query({ entity: 'audit-test-entity', from: '2020-01-15', to: '2020-01-15' })
        .set(auth(ownerToken));

      expect(inRange.status).toBe(200);
      const inRangeBody = inRange.body as { data: { entries: { id: string }[] } };
      expect(inRangeBody.data.entries.map((e) => e.id)).toContain(entry.id);

      // The day after the entry — the WHOLE day it names must not leak into
      // an adjacent day's range, in either direction.
      const outOfRange = await request(app)
        .get('/api/v1/audit')
        .query({ entity: 'audit-test-entity', from: '2020-01-16' })
        .set(auth(ownerToken));

      const outOfRangeBody = outOfRange.body as { data: { entries: { id: string }[] } };
      expect(outOfRangeBody.data.entries.map((e) => e.id)).not.toContain(entry.id);
    } finally {
      await prisma.auditLog.delete({ where: { id: entry.id } });
    }
  });

  it('lists distinct entities for the filter dropdown, staff-area gated', async () => {
    const support = await makeUser(StaffRole.SUPPORT, 'auditentities');

    expect(
      (await request(app).get('/api/v1/audit/entities').set(auth(support.token))).status,
    ).toBe(403);

    const res = await request(app).get('/api/v1/audit/entities').set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as { data: string[] };
    expect(Array.isArray(body.data)).toBe(true);
    // Written earlier in this suite (the redaction test, entity: 'user').
    expect(body.data).toContain('user');
  });
});
