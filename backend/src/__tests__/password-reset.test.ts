import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Redeeming an admin-issued one-time password reset token.
 *
 * This is the ONE unauthenticated write in the whole API — anyone can submit
 * a token, which is exactly why every failure mode (unknown, used, expired)
 * must look identical. Telling them apart is free reconnaissance over which
 * tokens exist and which have already been claimed.
 */

const app = createApp();

interface ErrorBody {
  error: { code: string; message: string };
}

const RUN = `pwreset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let ownerToken = '';

async function makeUser(tag: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      name: `${RUN} ${tag}`,
      role: StaffRole.SUPPORT,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return { id: user.id, token: signToken(user) };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function issueToken(userId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/staff/${userId}/reset-token`)
    .set(auth(ownerToken));

  return (res.body as { data: { token: string } }).data.token;
}

function redeem(token: string, password = 'a-brand-new-sufficiently-long-password') {
  return request(app).post('/api/v1/auth/reset-password').send({ token, password });
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `${RUN}-owner@example.test`,
      name: `${RUN} owner`,
      role: StaffRole.OWNER,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(owner.id);
  ownerToken = signToken(owner);
});

afterAll(async () => {
  // Cascades to each user's password_reset_tokens rows.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('the happy path', () => {
  it('sets the new password and revokes every existing session', async () => {
    const subject = await makeUser('happy');
    const token = await issueToken(subject.id);

    // The OLD token still works until redemption.
    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(200);

    const res = await redeem(token, 'a-brand-new-sufficiently-long-password');
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: subject.id } });
    expect(
      await bcrypt.compare('a-brand-new-sufficiently-long-password', user?.passwordHash ?? ''),
    ).toBe(true);

    // The session that existed BEFORE the reset must not survive it.
    expect((await request(app).get('/api/v1/orders').set(auth(subject.token))).status).toBe(401);
  });

  it('clears a lockout as part of the reset', async () => {
    const subject = await makeUser('locked');
    await prisma.user.update({
      where: { id: subject.id },
      data: { lockedUntil: new Date(Date.now() + 900_000), failedLoginAttempts: 5 },
    });

    const token = await issueToken(subject.id);
    await redeem(token);

    const after = await prisma.user.findUnique({ where: { id: subject.id } });
    expect(after?.lockedUntil).toBeNull();
    expect(after?.failedLoginAttempts).toBe(0);
  });
});

describe('single use', () => {
  it('cannot be redeemed a second time', async () => {
    const subject = await makeUser('singleuse');
    const token = await issueToken(subject.id);

    expect((await redeem(token)).status).toBe(200);

    const second = await redeem(token, 'yet-another-sufficiently-long-password');
    expect(second.status).toBe(400);
  });

  it('two concurrent redemptions of the same token — only one wins', async () => {
    // The TOCTOU case: without an atomic claim, both requests could read the
    // token as still valid before either write landed, and both would set a
    // password. Fire them at literally the same time.
    const subject = await makeUser('racecondition');
    const token = await issueToken(subject.id);

    const [a, b] = await Promise.all([
      redeem(token, 'password-from-request-a-long-enough'),
      redeem(token, 'password-from-request-b-long-enough'),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);

    const winningPassword =
      a.status === 200 ? 'password-from-request-a-long-enough' : 'password-from-request-b-long-enough';
    const user = await prisma.user.findUnique({ where: { id: subject.id } });
    expect(await bcrypt.compare(winningPassword, user?.passwordHash ?? '')).toBe(true);
  });
});

describe('expiry', () => {
  it('rejects a token past its expiry', async () => {
    const subject = await makeUser('expired');
    const token = await issueToken(subject.id);

    // Force it into the past rather than waiting out the real TTL.
    await prisma.passwordResetToken.updateMany({
      where: { userId: subject.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await redeem(token);
    expect(res.status).toBe(400);
  });
});

describe('every failure looks the same', () => {
  it('an unknown token, a used token, and an expired token get an identical response', async () => {
    const unknown = await redeem('NOPE-NOPE-NOPE');

    const usedSubject = await makeUser('used');
    const usedToken = await issueToken(usedSubject.id);
    await redeem(usedToken);
    const used = await redeem(usedToken, 'another-different-sufficiently-long-password');

    const expiredSubject = await makeUser('expiredsame');
    const expiredToken = await issueToken(expiredSubject.id);
    await prisma.passwordResetToken.updateMany({
      where: { userId: expiredSubject.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await redeem(expiredToken);

    expect(unknown.status).toBe(used.status);
    expect(used.status).toBe(expired.status);

    const unknownBody = unknown.body as ErrorBody;
    const usedBody = used.body as ErrorBody;
    const expiredBody = expired.body as ErrorBody;
    expect(unknownBody.error.message).toBe(usedBody.error.message);
    expect(usedBody.error.message).toBe(expiredBody.error.message);
  });
});

describe('input validation', () => {
  it('rejects a short new password', async () => {
    const subject = await makeUser('shortpw');
    const token = await issueToken(subject.id);

    const res = await redeem(token, 'short');
    expect(res.status).toBe(400);
  });

  it('never accepts a request missing a token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ password: 'a-sufficiently-long-password' });

    expect(res.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('rate-limits redemption attempts — the only defence on an unauthenticated route', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => redeem('GUESS-GUESS-GUESS')),
    );

    expect(attempts.some((res) => res.status === 429)).toBe(true);
  });
});
