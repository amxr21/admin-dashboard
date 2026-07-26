import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { login, signToken, toSafeUser, verifyToken } from '../services/auth.service.js';

/**
 * Auth is the highest-value surface in the API: everything else sits behind it.
 * These cover the full matrix — success, wrong password, unknown user, locked
 * out, deactivated, expired access, malformed input, and missing/invalid tokens.
 *
 * ISOLATION: every user is namespaced with a unique run id and deleted in
 * afterAll. Seed data is never touched.
 */

const app = createApp();

const RUN = `authtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct-horse-battery-staple';
const createdUserIds: string[] = [];

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}
interface LoginBody {
  data: { token: string; user: { id: string; email: string; passwordHash?: unknown } };
}

async function makeUser(
  label: string,
  overrides: Partial<{ isActive: boolean; accessExpiresAt: Date | null }> = {},
) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: label,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      ...overrides,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/login', () => {
  it('returns a token and the user on valid credentials', async () => {
    const user = await makeUser('valid');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    const body = res.body as LoginBody;

    expect(res.status).toBe(200);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.email).toBe(user.email);
  });

  it('NEVER returns the password hash or lockout counters', async () => {
    // The single most damaging thing this endpoint could leak: the bcrypt hash
    // is crackable offline, and the attempt counter tells an attacker exactly
    // how many tries remain.
    const user = await makeUser('no-leak');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    const serialised = JSON.stringify(res.body);

    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('failedLoginAttempts');
    expect(serialised).not.toContain('lockedUntil');
    expect(serialised).not.toContain(user.passwordHash);
  });

  it('rejects a wrong password with 401', async () => {
    const user = await makeUser('wrong-pw');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not-the-password' });

    expect(res.status).toBe(401);
  });

  it('gives an identical response for unknown user and wrong password', async () => {
    // Different messages here would turn the login form into a user-enumeration
    // oracle — an attacker learns which emails are real without guessing a
    // single password.
    const user = await makeUser('enumeration');

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong' });

    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${RUN}-does-not-exist@example.test`, password: 'wrong' });

    expect(unknownUser.status).toBe(wrongPassword.status);
    expect((unknownUser.body as ErrorBody).error.message).toBe(
      (wrongPassword.body as ErrorBody).error.message,
    );
  });

  it('rejects a malformed email with 400, not 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: PASSWORD });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.code).toBe('BAD_REQUEST');
  });

  it('rejects unexpected fields rather than ignoring them', async () => {
    // .strict() guards against mass assignment — a body carrying `role: OWNER`
    // must be refused, not silently dropped.
    const user = await makeUser('strict');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD, role: 'OWNER' });

    expect(res.status).toBe(400);
  });

  it('refuses a deactivated account even with the correct password', async () => {
    const user = await makeUser('deactivated', { isActive: false });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(403);
  });

  it('refuses an account whose access period has ended', async () => {
    const user = await makeUser('expired', {
      accessExpiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(403);
  });
});

describe('brute-force protection', () => {
  /**
   * Every Supertest request originates from the same address, so the per-IP
   * limiter (10 per 15 min) trips before the per-account lockout threshold can
   * be reached across several tests. That is CORRECT production behaviour —
   * the two layers stack — but it makes the account lockout untestable through
   * HTTP.
   *
   * So these drive the service directly. The per-IP layer has its own test
   * below; this block is specifically about the per-ACCOUNT layer, which is
   * what stops a distributed attack that no IP limiter would ever see.
   */
  it('locks the account after the configured number of failures', async () => {
    const user = await makeUser('lockout');

    for (let attempt = 0; attempt < env.LOGIN_MAX_ATTEMPTS; attempt += 1) {
      await expect(login(user.email, 'wrong')).rejects.toThrow();
    }

    // The correct password must now be refused too — that is what makes it a
    // lockout rather than just a counter.
    await expect(login(user.email, PASSWORD)).rejects.toMatchObject({
      statusCode: 423,
      code: 'ACCOUNT_LOCKED',
    });
  });

  it('counts failures per account, not globally', async () => {
    // A lockout on one account must not affect another, or one attacker could
    // deny service to every user by failing against a single email.
    const victim = await makeUser('victim');
    const bystander = await makeUser('bystander');

    for (let attempt = 0; attempt < env.LOGIN_MAX_ATTEMPTS; attempt += 1) {
      await expect(login(victim.email, 'wrong')).rejects.toThrow();
    }

    const result = await login(bystander.email, PASSWORD);

    expect(result.token).toBeTruthy();
  });

  it('rate-limits repeated login attempts from one IP', async () => {
    // The other half of the defence: this is what stops one address spraying
    // a single password across many accounts without locking any of them.
    const user = await makeUser('ip-limit');

    let sawRateLimit = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong' });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    expect(sawRateLimit).toBe(true);
  });

  it('clears the failure count after a successful login', async () => {
    // Otherwise a user who mistypes four times and then succeeds stays one
    // mistake away from a lockout indefinitely.
    const user = await makeUser('reset-counter');

    await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'wrong' });
    await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });

    const read = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(read.failedLoginAttempts).toBe(0);
    expect(read.lockedUntil).toBeNull();
  });
});

describe('GET /api/v1/auth/me', () => {
  let token = '';
  let userId = '';

  beforeEach(async () => {
    const user = await makeUser(`me-${Math.random().toString(36).slice(2, 7)}`);
    userId = user.id;
    token = signToken(user);
  });

  it('returns the current user with a valid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as { data: { id: string } }).data.id).toBe(userId);
  });

  it('accepts a lowercase "bearer" scheme', async () => {
    // RFC 7235 defines the scheme as case-insensitive and real clients send it
    // lowercase. Rejecting it is a needless interop bug.
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    // A forged token. If this ever passes, the signature is not being checked.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMiLCJyb2xlIjoiT1dORVIifQ.' +
      'wrong-signature-entirely';

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  it('returns 401 once the user is deactivated, even with a still-valid token', async () => {
    // The token proves who signed in, not that the account is still valid.
    // Without a per-request check, a revoked user keeps access until expiry.
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

describe('token handling', () => {
  it('round-trips a signed token', async () => {
    const user = await makeUser('roundtrip');

    const payload = verifyToken(signToken(user));

    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe(user.role);
  });

  it('rejects a tampered token', async () => {
    const user = await makeUser('tampered');
    const token = signToken(user);

    // Flip the last character of the signature.
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

    expect(() => verifyToken(tampered)).toThrow();
  });

  it('toSafeUser strips every sensitive field', async () => {
    const user = await makeUser('safe-user');

    const safe = toSafeUser(user) as Record<string, unknown>;

    expect(safe.passwordHash).toBeUndefined();
    expect(safe.failedLoginAttempts).toBeUndefined();
    expect(safe.lockedUntil).toBeUndefined();
    expect(safe.email).toBe(user.email);
  });
});
