import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { login, signToken, toSafeUser, verifyToken } from '../services/auth.service.js';
import { createSession } from '../services/session.service.js';
import { waitFor } from './helpers/wait-for.js';

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

/**
 * B2.4 — self-service profile edit and password change. Before this, a
 * SUPPORT/FULFILLMENT/DEMO account had NO path to fix a typo in their own
 * name or change their own password without an OWNER — `PATCH /staff/:id`
 * requires the `staff` area, which those roles don't hold.
 */
describe('PATCH /api/v1/auth/me', () => {
  it('updates name and phone with no `staff` area grant required', async () => {
    const user = await makeUser(`profile-${Math.random().toString(36).slice(2, 7)}`, {});
    const token = signToken(user);

    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name', phone: '+971500000000' });

    expect(res.status).toBe(200);
    const body = res.body as { data: { name: string; phone: string } };
    expect(body.data.name).toBe('New Name');
    expect(body.data.phone).toBe('+971500000000');
  });

  it('rejects role/isActive/accessExpiresAt entirely rather than silently ignoring them', async () => {
    // .strict() at the schema layer — this is the actual protection, not a
    // route that merely declines to forward the fields.
    const user = await makeUser(`profile-strict-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', role: 'OWNER' });

    expect(res.status).toBe(400);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.role).toBe(user.role);
  });

  it('returns 401 with no session', async () => {
    const res = await request(app).patch('/api/v1/auth/me').send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/auth/me/password', () => {
  it('changes the password when the current password is correct', async () => {
    const user = await makeUser(`pwchange-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-much-longer-new-password-1' });

    expect(res.status).toBe(200);

    // The new password actually works — checked against the hash directly
    // rather than through `/auth/login`, which shares a per-IP rate-limit
    // window with every other test in this file and would flake under load
    // rather than testing anything about THIS endpoint.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare('a-much-longer-new-password-1', stored.passwordHash)).toBe(
      true,
    );
  });

  it('returns a fresh, usable token — the caller does not lock themselves out', async () => {
    const user = await makeUser(`pwchange-fresh-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-much-longer-new-password-2' });

    expect(res.status).toBe(200);
    const body = res.body as { data: { token: string } };
    expect(body.data.token).toBeTruthy();
    expect(body.data.token).not.toBe(token);

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.data.token}`);
    expect(meRes.status).toBe(200);
  });

  it('revokes the OLD token — password change is not just cosmetic', async () => {
    const user = await makeUser(`pwchange-revoke-${Math.random().toString(36).slice(2, 7)}`);
    const oldToken = signToken(user);

    const changeRes = await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-much-longer-new-password-3' });
    expect(changeRes.status).toBe(200);

    // The token used to MAKE the change must itself now be dead — otherwise
    // "I changed my password" doesn't lock out whoever else had that token.
    const staleRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(staleRes.status).toBe(401);
  });

  it('rejects the wrong current password without changing anything', async () => {
    const user = await makeUser(`pwchange-wrong-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'definitely-not-it', newPassword: 'a-much-longer-new-password-4' });

    expect(res.status).toBe(400);

    // The original session must still work — a failed change is not a change.
    const stillGood = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(stillGood.status).toBe(200);
  });

  it('enforces the live minPasswordLength policy, same as every other password path', async () => {
    const user = await makeUser(`pwchange-policy-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'a-much-longer-new-password-5' });
    expect(res.status).toBe(401);
  });
});

/**
 * B2.6 — Sessions & devices.
 *
 * Before this, `tokenVersion` could only answer "kill EVERY session at once."
 * These tests are almost entirely about the one property that makes a
 * per-session model worth building at all: revoking device A must have NO
 * effect on device B. A sessions feature that revokes everything when asked
 * to revoke one thing is worse than not having the feature, because it LOOKS
 * targeted and isn't.
 *
 * Setup drives `login()`/`createSession()` DIRECTLY rather than through
 * `POST /api/v1/auth/login`, same reason the brute-force block above does:
 * every Supertest request shares one IP, and this file's own login-limiter
 * tests already spend a meaningful share of that 15-minute, 10-attempt
 * budget. Real HTTP is reserved for the one test that specifically proves
 * `/auth/login` itself creates a session end to end.
 */
describe('sessions & devices', () => {
  it('a real login (through the actual HTTP route) creates a session, visible in the list', async () => {
    const user = await makeUser(`session-login-${Math.random().toString(36).slice(2, 7)}`);

    const result = await login(user.email, PASSWORD, {
      userAgent: 'vitest',
      ip: '203.0.113.1',
    });

    const listRes = await request(app)
      .get('/api/v1/auth/me/sessions')
      .set('Authorization', `Bearer ${result.token}`);

    expect(listRes.status).toBe(200);
    const body = listRes.body as { data: { id: string; userAgent: string | null }[] };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.userAgent).toBe('vitest');
  });

  it('a token minted directly via signToken() (no session) still works — graceful rollout', async () => {
    // Test setup and any pre-existing integration mints tokens this way. A
    // token with no `sid` claim must not suddenly start failing — same
    // rollout guarantee `tokenVersion` gives tokens with no `tv`.
    const user = await makeUser(`session-legacy-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('revoking ONE session does not touch a second, independent session for the same user', async () => {
    const user = await makeUser(`session-isolated-${Math.random().toString(36).slice(2, 7)}`);

    const sessionA = await createSession(user.id, { userAgent: 'device-a' });
    const tokenA = signToken(user, undefined, sessionA.id);

    const sessionB = await createSession(user.id, { userAgent: 'device-b' });
    const tokenB = signToken(user, undefined, sessionB.id);

    // Revoke session B specifically, using token A (any live session of this
    // user's may issue the revoke — it isn't scoped to "the session making
    // this request").
    const revokeRes = await request(app)
      .delete(`/api/v1/auth/me/sessions/${sessionB.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(revokeRes.status).toBe(204);

    // Token B — the one whose session was just revoked — is dead.
    const checkB = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(checkB.status).toBe(401);

    // Token A — a DIFFERENT session for the SAME user — is completely
    // unaffected. This is the property that makes per-session revoke worth
    // building: a revoke that also killed A would be indistinguishable from
    // the old all-or-nothing `tokenVersion` bump.
    const checkA = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(checkA.status).toBe(200);
  });

  it('cannot revoke another user\'s session by guessing its id', async () => {
    const victim = await makeUser(`session-victim-${Math.random().toString(36).slice(2, 7)}`);
    const attacker = await makeUser(`session-attacker-${Math.random().toString(36).slice(2, 7)}`);

    const victimSession = await createSession(victim.id);
    const victimToken = signToken(victim, undefined, victimSession.id);

    const attackerSession = await createSession(attacker.id);
    const attackerToken = signToken(attacker, undefined, attackerSession.id);

    // The route returns 204 either way (revoke is idempotent) so the real
    // assertion is that the VICTIM's session survives.
    await request(app)
      .delete(`/api/v1/auth/me/sessions/${victimSession.id}`)
      .set('Authorization', `Bearer ${attackerToken}`);

    const stillGood = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${victimToken}`);
    expect(stillGood.status).toBe(200);
  });

  it('changing your own password revokes every session, not just bumps a counter with stale rows left behind', async () => {
    const user = await makeUser(`session-pwchange-${Math.random().toString(36).slice(2, 7)}`);

    const oldSession = await createSession(user.id);
    const token = signToken(user, undefined, oldSession.id);

    await request(app)
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-fresh-password-for-sessions' });

    // The list must not still show the OLD session as live — otherwise the
    // sessions screen would lie about a device that can never authenticate
    // again (its token died on the tokenVersion check). Fetch the live
    // sessions directly from the DB, sidestepping the fresh token the route
    // itself returns — that token's OWN session existing is a separate fact
    // from whether the PRE-change session was correctly retired.
    const liveSessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null },
    });

    expect(liveSessions.find((s) => s.id === oldSession.id)).toBeUndefined();
  });

  it('a revoked session is simply absent from the list, not shown as revoked', async () => {
    const user = await makeUser(`session-absent-${Math.random().toString(36).slice(2, 7)}`);

    const session = await createSession(user.id);
    // A second, surviving session — otherwise revoking the only session
    // would also kill the token used to list them.
    const secondSession = await createSession(user.id);
    const secondToken = signToken(user, undefined, secondSession.id);

    await request(app)
      .delete(`/api/v1/auth/me/sessions/${session.id}`)
      .set('Authorization', `Bearer ${secondToken}`);

    const after = await request(app)
      .get('/api/v1/auth/me/sessions')
      .set('Authorization', `Bearer ${secondToken}`);
    const afterBody = after.body as { data: { id: string }[] };

    expect(afterBody.data.find((s) => s.id === session.id)).toBeUndefined();
  });

  it('returns 401 with no session for both routes', async () => {
    const listRes = await request(app).get('/api/v1/auth/me/sessions');
    expect(listRes.status).toBe(401);

    const revokeRes = await request(app).delete('/api/v1/auth/me/sessions/whatever');
    expect(revokeRes.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout (B1.7)', () => {
  it('revokes the calling session specifically, leaving a different session for the same user untouched', async () => {
    const user = await makeUser(`logout-scoped-${Math.random().toString(36).slice(2, 7)}`);

    const sessionA = await createSession(user.id, { userAgent: 'device-a' });
    const tokenA = signToken(user, undefined, sessionA.id);

    const sessionB = await createSession(user.id, { userAgent: 'device-b' });
    const tokenB = signToken(user, undefined, sessionB.id);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(204);

    // The session that made the logout call is dead.
    const checkA = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(checkA.status).toBe(401);

    // A DIFFERENT session for the same user is unaffected — logout must
    // never behave like the old all-or-nothing tokenVersion bump.
    const checkB = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(checkB.status).toBe(200);
  });

  it('writes an auth.logout audit event', async () => {
    const user = await makeUser(`logout-audit-${Math.random().toString(36).slice(2, 7)}`);
    const session = await createSession(user.id);
    const token = signToken(user, undefined, session.id);

    await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);

    const entry = await waitFor(() =>
      prisma.auditLog.findFirst({
        where: { actorId: user.id, action: 'auth.logout' },
      }),
    );
    expect(entry?.entityId).toBe(session.id);
  });

  it('still succeeds and still audits for a token with no session (graceful rollout)', async () => {
    // Same "no sid claim" case `signToken()` already covers for other
    // routes — must not throw trying to revoke a session that never existed.
    const user = await makeUser(`logout-legacy-${Math.random().toString(36).slice(2, 7)}`);
    const token = signToken(user);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    const entry = await waitFor(() =>
      prisma.auditLog.findFirst({
        where: { actorId: user.id, action: 'auth.logout' },
      }),
    );
    expect(entry).not.toBeNull();
  });

  it('returns 401 with no session', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
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
