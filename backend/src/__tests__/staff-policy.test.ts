import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { settingKeys } from '../config/settings.config.js';
import { isIpAllowed, parseAllowlist } from '../lib/ip-allowlist.js';

/**
 * B3.6 — Staff & permissions policy: IP allowlist and 2FA-required-for-roles.
 * (Default invite role is a UI pre-select only — nothing server-side to test
 * beyond the setting itself existing, already covered by settings.test.ts's
 * generic registry tests.)
 *
 * Both new checks share the same safety-rail shape as `assertNotInMaintenance`:
 * OWNER/DEVELOPER exempt, empty-by-default, never blocks reads. These tests
 * exist specifically to prove those rails hold — a wrong config here is a
 * total lockout, which is a materially worse failure than the feature simply
 * not working.
 */

const app = createApp();

interface ErrorBody {
  error: { code: string; message: string };
}

const RUN = `staffpolicytest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let ownerToken = '';
let supportToken = '';

async function makeUser(role: StaffRole, overrides: { twoFactorEnabled?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
      twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    },
  });
  userIds.push(user.id);
  return signToken(user);
}

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterEach(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: settingKeys() } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

function save(body: Record<string, unknown>, token = ownerToken) {
  return request(app).patch('/api/v1/settings').set(auth(token)).send(body);
}

describe('lib/ip-allowlist', () => {
  it('matches an exact address', () => {
    const entries = parseAllowlist('203.0.113.5');
    expect(isIpAllowed('203.0.113.5', entries)).toBe(true);
    expect(isIpAllowed('203.0.113.6', entries)).toBe(false);
  });

  it('matches a CIDR range', () => {
    const entries = parseAllowlist('203.0.113.0/24');
    expect(isIpAllowed('203.0.113.200', entries)).toBe(true);
    expect(isIpAllowed('203.0.114.1', entries)).toBe(false);
  });

  it('ignores an unparseable entry rather than failing the whole list', () => {
    const entries = parseAllowlist('not-an-ip, 203.0.113.5');
    expect(entries).toHaveLength(1);
    expect(isIpAllowed('203.0.113.5', entries)).toBe(true);
  });

  it('treats an empty string as no entries at all', () => {
    expect(parseAllowlist('')).toHaveLength(0);
  });
});

describe('IP allowlist enforcement (security.ipAllowlist)', () => {
  it('has no effect while empty (the default)', async () => {
    const res = await request(app).get('/api/v1/r/customers').set(auth(supportToken));
    expect(res.status).toBe(200);
  });

  it('blocks a non-exempt role whose IP matches nothing in the list', async () => {
    // supertest's requests come from a loopback address never present in an
    // explicitly-configured allowlist naming a different, unrelated network.
    await save({ 'security.ipAllowlist': '203.0.113.0/24' });

    const res = await request(app).get('/api/v1/r/customers').set(auth(supportToken));
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.message).toMatch(/network/i);
  });

  it('exempts OWNER unconditionally, even when the list matches nothing', async () => {
    await save({ 'security.ipAllowlist': '203.0.113.0/24' });

    const res = await request(app).get('/api/v1/r/customers').set(auth(ownerToken));
    expect(res.status).toBe(200);
  });

  it('never blocks an unauthenticated request (nothing to check yet)', async () => {
    await save({ 'security.ipAllowlist': '203.0.113.0/24' });

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });
});

describe('2FA-required-for-roles enforcement (security.require2faForRoles)', () => {
  it('has no effect while empty (the default)', async () => {
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(auth(ownerToken))
      .send({ 'store.name': `${RUN} unaffected` });
    expect(res.status).toBe(200);
  });

  it('blocks a WRITE from a listed role without 2FA enabled', async () => {
    await save({ 'security.require2faForRoles': 'SUPPORT' });

    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(supportToken))
      .send({ name: `${RUN} blocked`, email: `${RUN}-blocked@example.test` });

    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.message).toMatch(/two-factor/i);
  });

  it('never blocks a READ from a listed role without 2FA', async () => {
    await save({ 'security.require2faForRoles': 'SUPPORT' });

    const res = await request(app).get('/api/v1/r/customers').set(auth(supportToken));
    expect(res.status).toBe(200);
  });

  it('does not block a listed role that HAS 2FA enabled', async () => {
    await save({ 'security.require2faForRoles': 'SUPPORT' });
    const compliantToken = await makeUser(StaffRole.SUPPORT, { twoFactorEnabled: true });

    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(compliantToken))
      .send({ name: `${RUN} compliant`, email: `${RUN}-compliant@example.test` });

    expect(res.status).toBe(201);
    await prisma.customer.deleteMany({ where: { email: `${RUN}-compliant@example.test` } });
  });

  it('does not block a role that is not in the list', async () => {
    await save({ 'security.require2faForRoles': 'MANAGER' });

    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(supportToken))
      .send({ name: `${RUN} not listed`, email: `${RUN}-not-listed@example.test` });

    expect(res.status).toBe(201);
    await prisma.customer.deleteMany({ where: { email: `${RUN}-not-listed@example.test` } });
  });

  it('holds OWNER to the policy too, when OWNER is explicitly listed', async () => {
    // Deliberately DIFFERENT from the IP allowlist and maintenance-mode
    // checks, which exempt OWNER/DEVELOPER unconditionally: those exist to
    // guarantee a wrong config can't lock out the only people able to fix
    // it. 2FA policy has a safe way out already (any OWNER can edit this
    // setting, or another OWNER/DEVELOPER can remove them from the list),
    // so a blanket exemption here would mean an OWNER's own explicit
    // self-inclusion in the policy is silently ignored — the opposite of
    // what listing themselves was for.
    await save({ 'security.require2faForRoles': 'OWNER' });

    const res = await request(app)
      .post('/api/v1/r/customers')
      .set(auth(ownerToken))
      .send({ name: `${RUN} owner listed`, email: `${RUN}-owner-listed@example.test` });

    expect(res.status).toBe(403);
  });

  it('still lets a blocked, listed OWNER edit settings — the one write that could undo the block', async () => {
    // The real bug this test exists to catch: without a `PATCH /settings`
    // exemption, an OWNER who lists themselves would be blocked from every
    // write INCLUDING the settings save that could remove them from the
    // list again — a genuine self-lockout found while writing this test
    // suite, not assumed. `PATCH /settings` is exempted the same way the
    // 2FA setup routes are.
    await save({ 'security.require2faForRoles': 'OWNER' });

    const res = await save({ 'security.require2faForRoles': '' });
    expect(res.status).toBe(200);
  });

  it('still allows a non-compliant listed role to reach 2FA setup itself', async () => {
    await save({ 'security.require2faForRoles': 'SUPPORT' });

    // A wrong secret/code still 400s on its own terms — the point here is
    // ONLY that the request reaches the handler at all (not a 403 from this
    // policy), proving the exemption path works.
    const res = await request(app)
      .post('/api/v1/auth/me/2fa/setup')
      .set(auth(supportToken))
      .send({});

    expect(res.status).not.toBe(403);
  });
});
