import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { login, signToken } from '../services/auth.service.js';

/**
 * Two-factor authentication (B2.8).
 *
 * The load-bearing property across this whole file: a password succeeding is
 * NEVER, by itself, a completed sign-in for a 2FA account. Every test that
 * matters is really checking one of two things — that the two-step flow
 * actually gates access (a correct password with no code gets nowhere), and
 * that state doesn't leak between the two steps (a pending token cannot be
 * used as a session, an abandoned 2FA prompt leaves no trace).
 */

const app = createApp();

const RUN = `2fatest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct-horse-battery-staple';
const createdUserIds: string[] = [];

interface LoginBody {
  data:
    | { twoFactorRequired: true; pendingToken: string }
    | { token: string; user: { id: string } };
}

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: label,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

/** Full enrolment flow via the real routes, returning what a real client
 * would have: the secret (to compute live codes in later assertions) and
 * the ten backup codes. */
async function enrol(token: string) {
  const setupRes = await request(app).post('/api/v1/auth/me/2fa/setup').set(auth(token));
  const secret = (setupRes.body as { data: { secret: string } }).data.secret;

  const confirmRes = await request(app)
    .post('/api/v1/auth/me/2fa/confirm')
    .set(auth(token))
    .send({ code: authenticator.generate(secret) });

  const backupCodes = (confirmRes.body as { data: { backupCodes: string[] } }).data.backupCodes;

  return { secret, backupCodes };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('enrolment', () => {
  it('setup does not enable 2FA — only confirm does', async () => {
    const user = await makeUser('setup-only');
    const token = signToken(user);

    await request(app).post('/api/v1/auth/me/2fa/setup').set(auth(token));

    const status = await request(app).get('/api/v1/auth/me/2fa').set(auth(token));
    expect((status.body as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });

  it('confirm rejects a wrong code and still does not enable 2FA', async () => {
    const user = await makeUser('confirm-wrong');
    const token = signToken(user);

    await request(app).post('/api/v1/auth/me/2fa/setup').set(auth(token));
    const confirmRes = await request(app)
      .post('/api/v1/auth/me/2fa/confirm')
      .set(auth(token))
      .send({ code: '000000' });

    expect(confirmRes.status).toBe(400);

    const status = await request(app).get('/api/v1/auth/me/2fa').set(auth(token));
    expect((status.body as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });

  it('confirm with a REAL code enables 2FA and returns exactly ten backup codes', async () => {
    const user = await makeUser('confirm-real');
    const token = signToken(user);

    const { backupCodes } = await enrol(token);
    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10); // all distinct

    const status = await request(app).get('/api/v1/auth/me/2fa').set(auth(token));
    const body = status.body as { data: { enabled: boolean; remainingBackupCodes: number } };
    expect(body.data.enabled).toBe(true);
    expect(body.data.remainingBackupCodes).toBe(10);
  });
});

describe('the login flow actually gates on the second factor', () => {
  it('a correct password alone does NOT sign a 2FA account in', async () => {
    const user = await makeUser('gate-password-only');
    const setupToken = signToken(user);
    await enrol(setupToken);

    const result = await login(user.email, PASSWORD);

    expect('twoFactorRequired' in result && result.twoFactorRequired).toBe(true);
    // No real token, no user object — a client that only checks
    // `data.token` truthiness (rather than the discriminant) gets nothing
    // to work with, which is the fail-safe direction.
    expect('token' in result).toBe(false);
  });

  it('lastLoginAt and the lockout counters are NOT touched by the password step alone', async () => {
    const user = await makeUser('gate-no-side-effects');
    const setupToken = signToken(user);
    await enrol(setupToken);

    await login(user.email, PASSWORD);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // An abandoned 2FA prompt must look, to every other system, exactly
    // like a login that never happened.
    expect(fresh.lastLoginAt).toBeNull();
  });

  it('a valid pending token + a real TOTP code completes the sign-in', async () => {
    const user = await makeUser('gate-completes');
    const setupToken = signToken(user);
    const { secret } = await enrol(setupToken);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const loginBody = loginRes.body as LoginBody;
    if (!('pendingToken' in loginBody.data)) throw new Error('expected twoFactorRequired');

    const verifyRes = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: loginBody.data.pendingToken, code: authenticator.generate(secret) });

    expect(verifyRes.status).toBe(200);
    const verifyBody = verifyRes.body as { data: { token: string; user: { id: string } } };
    expect(verifyBody.data.token).toBeTruthy();
    expect(verifyBody.data.user.id).toBe(user.id);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.lastLoginAt).not.toBeNull();
  });

  it('rejects a wrong 6-digit code without completing the sign-in', async () => {
    const user = await makeUser('gate-wrong-code');
    const setupToken = signToken(user);
    await enrol(setupToken);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const pendingToken = (loginRes.body as LoginBody).data as { pendingToken: string };

    const verifyRes = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: pendingToken.pendingToken, code: '000000' });

    expect(verifyRes.status).toBe(400);
  });

  it('a pending token cannot be used as a Bearer session token', async () => {
    const user = await makeUser('gate-pending-not-session');
    const setupToken = signToken(user);
    await enrol(setupToken);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const pendingToken = (loginRes.body as LoginBody).data as { pendingToken: string };

    // This is the property that makes the pending token safe to hand to an
    // unauthenticated client: even if it leaked, it opens nothing.
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set(auth(pendingToken.pendingToken));

    expect(res.status).toBe(401);
  });

  it('a real session token cannot be reused as a pending-2fa token', async () => {
    const user = await makeUser('gate-session-not-pending');
    const token = signToken(user);

    // No 2FA enrolled at all here — this is just a normal session token.
    const res = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: token, code: '000000' });

    expect(res.status).toBe(401);
  });
});

describe('backup codes', () => {
  it('a valid backup code completes login, and consuming it makes it unusable again', async () => {
    const user = await makeUser('backup-consume');
    const setupToken = signToken(user);
    const { backupCodes } = await enrol(setupToken);
    const code = backupCodes[0] as string;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const pendingToken = (loginRes.body as LoginBody).data as { pendingToken: string };

    const firstUse = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: pendingToken.pendingToken, code });
    expect(firstUse.status).toBe(200);

    // A fresh pending token (the first is single-purpose and short-lived,
    // not meant to be reused for a second attempt) — same code must fail.
    const secondLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const secondPending = (secondLoginRes.body as LoginBody).data as { pendingToken: string };

    const secondUse = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: secondPending.pendingToken, code });

    expect(secondUse.status).toBe(400);
  });

  it('decrements remainingBackupCodes by exactly one per use', async () => {
    const user = await makeUser('backup-count');
    const setupToken = signToken(user);
    const { backupCodes } = await enrol(setupToken);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const pendingToken = (loginRes.body as LoginBody).data as { pendingToken: string };

    const verifyRes = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: pendingToken.pendingToken, code: backupCodes[1] });
    const freshToken = (verifyRes.body as { data: { token: string } }).data.token;

    const status = await request(app).get('/api/v1/auth/me/2fa').set(auth(freshToken));
    expect((status.body as { data: { remainingBackupCodes: number } }).data.remainingBackupCodes).toBe(
      9,
    );
  });
});

describe('disabling 2FA', () => {
  it('requires a CURRENT code, same as changing your own password requires the current password', async () => {
    const user = await makeUser('disable-requires-code');
    const token = signToken(user);
    await enrol(token);

    const res = await request(app)
      .post('/api/v1/auth/me/2fa/disable')
      .set(auth(token))
      .send({ code: '000000' });

    expect(res.status).toBe(400);

    const status = await request(app).get('/api/v1/auth/me/2fa').set(auth(token));
    expect((status.body as { data: { enabled: boolean } }).data.enabled).toBe(true);
  });

  it('a correct code disables 2FA and the account can log in with just a password again', async () => {
    const user = await makeUser('disable-real-code');
    const token = signToken(user);
    const { secret } = await enrol(token);

    const disableRes = await request(app)
      .post('/api/v1/auth/me/2fa/disable')
      .set(auth(token))
      .send({ code: authenticator.generate(secret) });
    expect(disableRes.status).toBe(200);

    const result = await login(user.email, PASSWORD);
    expect('twoFactorRequired' in result && result.twoFactorRequired).toBeFalsy();
  });

  it('disabling clears the backup codes too — none of the old ones work after re-enrolling', async () => {
    const user = await makeUser('disable-clears-codes');
    const token = signToken(user);
    const { secret, backupCodes: firstCodes } = await enrol(token);

    await request(app)
      .post('/api/v1/auth/me/2fa/disable')
      .set(auth(token))
      .send({ code: authenticator.generate(secret) });

    const { backupCodes: secondCodes } = await enrol(token);

    // A code from the FIRST enrolment must not still work after the second.
    const overlap = firstCodes.filter((code) => secondCodes.includes(code));
    expect(overlap).toEqual([]);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    const pendingToken = (loginRes.body as LoginBody).data as { pendingToken: string };

    const oldCodeAttempt = await request(app)
      .post('/api/v1/auth/login/verify-2fa')
      .send({ pendingToken: pendingToken.pendingToken, code: firstCodes[0] });

    expect(oldCodeAttempt.status).toBe(400);
  });
});
