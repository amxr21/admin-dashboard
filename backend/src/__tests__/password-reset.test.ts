import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { accountEmailSchema } from '../lib/identity-validation.js';
import { passwordResetIdentifierKey } from '../middleware/rateLimit.js';
import {
  preparePasswordReset,
  schedulePasswordResetDispatch,
} from '../services/password-reset.service.js';

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

async function waitForResetToken(userId: string) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const record = await prisma.passwordResetToken.findFirst({
      where: { userId, usedAt: null },
    });
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for deferred password-reset delivery');
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

/**
 * Self-service initiation (UX-035). The admin-issued path above assumes
 * someone to ask; this one exists for when there is nobody.
 *
 * Every assertion here is about what the response does NOT reveal. An
 * unauthenticated caller must not be able to tell a real staff address from
 * an invented one, because that turns the endpoint into a directory of who
 * works here — and a confirmed-valid address is what makes credential
 * stuffing worth attempting.
 *
 * These run before the shared rate-limit window is exhausted by the suite
 * above; the initiation limiter is a separate instance, so the two do not
 * interfere.
 */
describe('POST /api/v1/auth/forgot-password', () => {
  function forgot(email: string, ip = '198.51.100.10') {
    return request(app)
      .post('/api/v1/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email });
  }

  // First, deliberately: the initiation limiter allows 5 requests per window
  // and counts SUCCESSES too (unlike redemption, where only guesses matter —
  // see the limiter's own comment). Later tests in this block exhaust it, so
  // the one assertion that needs a non-429 rejection runs before they do.
  it('rejects a malformed address, which describes the request and not the account', async () => {
    const res = await forgot('not-an-email');

    expect(res.status).toBe(400);
  });

  it('answers identically for a real address and an unknown one', async () => {
    const subject = await makeUser('forgot-known');
    const known = await prisma.user.findUniqueOrThrow({
      where: { id: subject.id },
      select: { email: true },
    });

    const hit = await forgot(known.email);
    const miss = await forgot(`${RUN}-nobody-at-all@example.test`);

    expect(hit.status).toBe(200);
    expect(miss.status).toBe(200);
    // Byte-identical, not merely both-2xx: a differing body is the same leak
    // in a quieter form.
    expect(hit.body).toEqual(miss.body);
  });

  it('issues a redeemable token for a real address', async () => {
    const subject = await makeUser('forgot-issues');
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: subject.id },
      select: { email: true },
    });

    await forgot(email);

    // Polled, not read once: the token is written AFTER the response, so the
    // request deliberately returns before this row exists (see
    // `preparePasswordReset` on why SMTP and token generation stay off the
    // timed path). Reading immediately would race the dispatch.
    const record = await waitForResetToken(subject.id);

    // Only ever the HMAC — a readable token in this column would make the
    // database a list of live credentials.
    expect(record.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues nothing for a deactivated account, without saying so', async () => {
    const subject = await makeUser('forgot-inactive');
    await prisma.user.update({ where: { id: subject.id }, data: { isActive: false } });
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: subject.id },
      select: { email: true },
    });

    const res = await forgot(email);

    expect(res.status).toBe(200);

    // Run the dispatch directly as well, so "no token" is a real outcome
    // rather than a row that simply had not been written yet. Awaiting the
    // deferred half is the only way to distinguish the two — a bare read
    // after the response would pass even if the guard were removed.
    const dispatch = await preparePasswordReset(
      { log: { info: () => {} } } as unknown as Parameters<typeof preparePasswordReset>[0],
      email,
    );
    await dispatch();

    // A plain read, NOT waitForResetToken: that helper throws when no token
    // appears, so it can only ever express "a token arrived" — using it here
    // would make this assertion unreachable and the test permanently red. The
    // awaited dispatch above is what proves the work ran.
    const record = await prisma.passwordResetToken.findFirst({
      where: { userId: subject.id, usedAt: null },
    });

    // A deactivated ex-employee must not be able to reset their way back in,
    // but refusing DIFFERENTLY would confirm the account exists.
    expect(record).toBeNull();
  });

  // Calls the service directly rather than the route: the block above has
  // already spent the 5-request initiation window, and this property is about
  // normalization, not transport. Asserting it through HTTP would only be
  // re-testing the limiter.
  it('normalizes the address, so case cannot hide an account from its owner', async () => {
    const subject = await makeUser('forgot-case');
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: subject.id },
      select: { email: true },
    });

    // Awaiting the dispatch directly, rather than letting the route schedule
    // it: the token is written by the deferred half, so a test that only
    // called `prepare` would assert against work that had not run yet.
    const dispatch = await preparePasswordReset(
      { log: { info: () => {} } } as unknown as Parameters<typeof preparePasswordReset>[0],
      accountEmailSchema.parse(email.toUpperCase()),
    );
    await dispatch();

    const record = await prisma.passwordResetToken.findFirst({
      where: { userId: subject.id, usedAt: null },
    });
    expect(record).not.toBeNull();
  });

  it('uses a normalized HMAC identifier instead of the raw address as a limiter key', () => {
    const email = `${RUN}-Rate-Key@Example.Test`;
    const key = passwordResetIdentifierKey(email);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(email.toLowerCase());
    expect(key).toBe(passwordResetIdentifierKey(email.toLowerCase()));
  });

  it('rate-limits one address even when requests rotate through different IPs', async () => {
    const email = `${RUN}-distributed@example.test`;
    const attempts = [];

    for (let index = 0; index < 6; index += 1) {
      attempts.push(await forgot(email, `198.51.100.${50 + index}`));
    }

    expect(attempts.slice(0, 5).every((res) => res.status === 200)).toBe(true);
    expect(attempts[5]?.status).toBe(429);
  });

  it('keeps an independent per-IP ceiling when one source sprays addresses', async () => {
    const attempts = [];

    for (let index = 0; index < 6; index += 1) {
      attempts.push(await forgot(`${RUN}-spray-${index}@example.test`, '198.51.100.90'));
    }

    expect(attempts.slice(0, 5).every((res) => res.status === 200)).toBe(true);
    expect(attempts[5]?.status).toBe(429);
  });
});

describe('forgot-password response timing architecture', () => {
  it('does not create a token until the deferred dispatch runs', async () => {
    const subject = await makeUser('forgot-deferred');
    const { email } = await prisma.user.findUniqueOrThrow({
      where: { id: subject.id },
      select: { email: true },
    });
    const req = {
      log: { info: () => {}, error: () => {} },
    } as unknown as Parameters<typeof preparePasswordReset>[0];

    const dispatch = await preparePasswordReset(req, email);
    expect(
      await prisma.passwordResetToken.findFirst({ where: { userId: subject.id, usedAt: null } }),
    ).toBeNull();

    await dispatch();
    expect(
      await prisma.passwordResetToken.findFirst({ where: { userId: subject.id, usedAt: null } }),
    ).not.toBeNull();
  });

  it('schedules on a later event-loop turn and catches background failures', async () => {
    const errors: unknown[] = [];
    let started = false;
    const req = {
      log: { error: (entry: unknown) => errors.push(entry) },
    } as unknown as Parameters<typeof schedulePasswordResetDispatch>[0];

    // Returns a rejected promise rather than being an `async` body that only
    // throws: the dispatch type is `() => Promise<void>`, and there is nothing
    // here to await, so `async` would be syntax for its own sake.
    schedulePasswordResetDispatch(req, () => {
      started = true;
      return Promise.reject(new Error('controlled delivery failure'));
    });

    expect(started).toBe(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(started).toBe(true);
    expect(errors).toEqual([
      {
        event: 'auth.password-reset.dispatch-failed',
        error: 'controlled delivery failure',
      },
    ]);
  });
});
