import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { waitFor } from './helpers/wait-for.js';

/**
 * API keys (B3.2).
 *
 * The load-bearing property across this file: a key authenticates as its
 * OWNER, optionally NARROWED by `scopes`. So the tests that matter most are
 * about that inheritance being exact in both directions — a SUPPORT-owned key
 * can do what SUPPORT can and nothing more, a scope can only ever subtract
 * from that, and revoking a key must not touch the owner's own session (they
 * are two independent credentials for the same person, not one revoking the
 * other).
 *
 * The scope tests below exist because the intersection is a SECURITY claim: if
 * a scope could ever grant an area the owner lacks, every key would become a
 * privilege-escalation path. An unscoped key (`scopes: null`) must remain
 * exactly what it was before the column existed, which is what keeps every
 * already-issued key working.
 */

const app = createApp();

const RUN = `apikeytest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct-horse-battery-staple';
const createdUserIds: string[] = [];

interface CreatedKeyBody {
  data: { id: string; name: string; key: string; scopes: string[] | null };
}
interface ListBody {
  data: {
    id: string;
    name: string;
    keyPreview: string;
    scopes: string[] | null;
    lastUsedAt: string | null;
  }[];
}

async function makeUser(role: StaffRole, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: label,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('creating and listing keys', () => {
  it('returns the plaintext key exactly once, on creation', async () => {
    const user = await makeUser(StaffRole.OWNER, 'create');
    const token = signToken(user);

    const res = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'CI pipeline' });

    expect(res.status).toBe(201);
    const body = res.body as CreatedKeyBody;
    expect(body.data.key).toMatch(/^adk_/);
    expect(body.data.name).toBe('CI pipeline');
    expect(body.data.purpose).toBe('Test integration');
    expect(body.data.recipient).toBe('Test operator');
  });

  it('never returns the plaintext again from the list endpoint', async () => {
    const user = await makeUser(StaffRole.OWNER, 'no-leak');
    const token = signToken(user);

    await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Leak check' });

    const listRes = await request(app).get('/api/v1/auth/me/api-keys').set(auth(token));
    const serialised = JSON.stringify(listRes.body);

    // The preview is allowed to appear; the full plaintext must not.
    expect(serialised).not.toMatch(/adk_[A-Za-z0-9_-]{40}/);
  });

  it('lists only the requesting user\'s own keys', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'list-owner');
    const other = await makeUser(StaffRole.OWNER, 'list-other');
    const ownerToken = signToken(owner);
    const otherToken = signToken(other);

    await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(ownerToken))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Owner key' });
    await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(otherToken))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Other key' });

    const res = await request(app).get('/api/v1/auth/me/api-keys').set(auth(ownerToken));
    const body = res.body as ListBody;

    expect(body.data.some((k) => k.name === 'Owner key')).toBe(true);
    expect(body.data.some((k) => k.name === 'Other key')).toBe(false);
  });

  it('rejects an empty name', async () => {
    const user = await makeUser(StaffRole.OWNER, 'empty-name');
    const token = signToken(user);

    const res = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: '' });

    expect(res.status).toBe(400);
  });

  it('requires a purpose and recipient before issuing a credential', async () => {
    const user = await makeUser(StaffRole.OWNER, 'missing-context');
    const token = signToken(user);
    const res = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ name: 'Unaccounted key' });
    expect(res.status).toBe(400);
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/v1/auth/me/api-keys');
    expect(res.status).toBe(401);
  });
});

describe('a key authenticates as its OWNER, exactly', () => {
  it('a key can read what its OWNER can read', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'authn-owner');
    const ownerToken = signToken(owner);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(ownerToken))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Read test' });
    const key = (createRes.body as CreatedKeyBody).data.key;

    const res = await request(app).get('/api/v1/auth/me').set(auth(key));

    expect(res.status).toBe(200);
    const body = res.body as { data: { id: string; role: StaffRole } };
    expect(body.data.id).toBe(owner.id);
    expect(body.data.role).toBe(StaffRole.OWNER);
  });

  it('a key owned by SUPPORT is refused the areas SUPPORT cannot reach — same as SUPPORT\'s own session', async () => {
    const support = await makeUser(StaffRole.SUPPORT, 'authn-support');
    const supportToken = signToken(support);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(supportToken))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Support key' });
    const key = (createRes.body as CreatedKeyBody).data.key;

    // SUPPORT does not hold the `staff` area — a key inheriting MORE than
    // its owner would be the actual security bug this design exists to
    // prevent.
    const res = await request(app).get('/api/v1/staff').set(auth(key));
    expect(res.status).toBe(403);
  });

  it('a deactivated owner\'s key stops working immediately, same as their session would', async () => {
    const user = await makeUser(StaffRole.OWNER, 'authn-deactivated');
    const secondOwner = await makeUser(StaffRole.OWNER, 'authn-deactivated-2');
    const token = signToken(user);
    const secondToken = signToken(secondOwner);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Will be deactivated' });
    const key = (createRes.body as CreatedKeyBody).data.key;

    await request(app)
      .patch(`/api/v1/staff/${user.id}`)
      .set(auth(secondToken))
      .send({ isActive: false });

    const res = await request(app).get('/api/v1/auth/me').set(auth(key));
    expect(res.status).toBe(401);
  });

  it('rejects an unknown key with the SAME message as an invalid session token', async () => {
    const forged = 'adk_' + 'x'.repeat(43);

    const forgedKeyRes = await request(app).get('/api/v1/auth/me').set(auth(forged));
    const forgedSessionRes = await request(app)
      .get('/api/v1/auth/me')
      .set(auth('not-a-real-jwt'));

    expect(forgedKeyRes.status).toBe(401);
    expect(forgedSessionRes.status).toBe(401);
    expect((forgedKeyRes.body as { error: { message: string } }).error.message).toBe(
      (forgedSessionRes.body as { error: { message: string } }).error.message,
    );
  });

  it('updates lastUsedAt after being used to authenticate', async () => {
    const user = await makeUser(StaffRole.OWNER, 'last-used');
    const token = signToken(user);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Tracks last used' });
    const key = (createRes.body as CreatedKeyBody).data.key;

    await request(app).get('/api/v1/auth/me').set(auth(key));

    /**
     * `lastUsedAt` is written fire-and-forget — `void prisma.apiKey.update(...)`
     * in api-key.service.ts, so authentication is never delayed or failed by
     * bookkeeping. That means the row can land AFTER the request that
     * triggered it has already returned.
     *
     * Reading the list immediately therefore races the write, and won locally
     * only because the machine is fast; on CI it lost and failed as "expected
     * null to be truthy". Same cause as the audit-log races fixed alongside
     * this — three tests, one pattern.
     */
    const found = await waitFor(async () => {
      const listRes = await request(app).get('/api/v1/auth/me/api-keys').set(auth(token));
      const body = listRes.body as ListBody;
      const row = body.data.find((k) => k.name === 'Tracks last used');
      return row?.lastUsedAt ? row : null;
    });

    expect(found.lastUsedAt).toBeTruthy();
  });
});

describe('scopes NARROW a key, and can never widen it', () => {
  /** Issue a key for `owner`, optionally scoped. */
  async function makeKey(ownerToken: string, name: string, scopes?: readonly string[]) {
    const res = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(ownerToken))
      .send({
        name,
        purpose: 'Test integration',
        recipient: 'Test operator',
        ...(scopes ? { scopes } : {}),
      });

    return res;
  }

  it('an unscoped key behaves exactly as it did before scopes existed', async () => {
    // The backward-compatibility guarantee. Every key issued before this
    // column was added has `scopes: null`, and must keep full owner access.
    const owner = await makeUser(StaffRole.OWNER, 'scope-unscoped');
    const res = await makeKey(signToken(owner), 'Unscoped');
    const { key, scopes } = (res.body as CreatedKeyBody).data;

    expect(scopes).toBeNull();

    const staffRes = await request(app).get('/api/v1/staff').set(auth(key));
    expect(staffRes.status).toBe(200);
  });

  it('a scoped key reaches the area it names', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'scope-allowed');
    const res = await makeKey(signToken(owner), 'Staff only', ['staff']);
    const { key, scopes } = (res.body as CreatedKeyBody).data;

    expect(scopes).toEqual(['staff']);

    const staffRes = await request(app).get('/api/v1/staff').set(auth(key));
    expect(staffRes.status).toBe(200);
  });

  it('the SAME owner token still reaches an area their scoped key cannot', async () => {
    /**
     * The point of scoping, stated as a contrast: one credential is narrowed
     * and the other is not, for the identical human. Without this pairing a
     * 403 below could just mean the owner lacked the area all along.
     */
    const owner = await makeUser(StaffRole.OWNER, 'scope-contrast');
    const ownerToken = signToken(owner);
    const res = await makeKey(ownerToken, 'Products only', ['products']);
    const { key } = (res.body as CreatedKeyBody).data;

    const viaKey = await request(app).get('/api/v1/staff').set(auth(key));
    expect(viaKey.status).toBe(403);

    const viaSession = await request(app).get('/api/v1/staff').set(auth(ownerToken));
    expect(viaSession.status).toBe(200);
  });

  it('a scope cannot GRANT an area the owner does not hold', async () => {
    /**
     * The escalation case, and the reason the check is an intersection rather
     * than a replacement. SUPPORT does not hold `staff`; naming it in a scope
     * must change nothing. If this ever returns 200, every key in the system
     * is a way around RBAC.
     */
    const support = await makeUser(StaffRole.SUPPORT, 'scope-escalate');
    const res = await makeKey(signToken(support), 'Escalation attempt', ['staff']);
    const { key } = (res.body as CreatedKeyBody).data;

    const staffRes = await request(app).get('/api/v1/staff').set(auth(key));
    expect(staffRes.status).toBe(403);
  });

  it('refuses an empty scope list rather than reading it as "everything"', async () => {
    // A key that may reach nothing is not a useful credential, and the
    // dangerous misreading of `[]` is "unrestricted" — so it is a 400.
    const owner = await makeUser(StaffRole.OWNER, 'scope-empty');
    const res = await makeKey(signToken(owner), 'Empty scopes', []);

    expect(res.status).toBe(400);
  });

  it('refuses a scope naming something that is not an area', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'scope-bogus');
    const res = await makeKey(signToken(owner), 'Bogus scope', ['not-an-area']);

    expect(res.status).toBe(400);
  });

  it('lists a key with its scopes, so an admin can see what it reaches', async () => {
    const owner = await makeUser(StaffRole.OWNER, 'scope-listed');
    const ownerToken = signToken(owner);
    await makeKey(ownerToken, 'Listed scoped', ['orders', 'products']);

    const listRes = await request(app).get('/api/v1/auth/me/api-keys').set(auth(ownerToken));
    const row = (listRes.body as ListBody).data.find((entry) => entry.name === 'Listed scoped');

    expect(row?.scopes).toEqual(['orders', 'products']);
  });
});

describe('revoking a key', () => {
  it('a revoked key can no longer authenticate', async () => {
    const user = await makeUser(StaffRole.OWNER, 'revoke');
    const token = signToken(user);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'To be revoked' });
    const created = (createRes.body as CreatedKeyBody).data;

    const revokeRes = await request(app)
      .delete(`/api/v1/auth/me/api-keys/${created.id}`)
      .set(auth(token));
    expect(revokeRes.status).toBe(204);

    const res = await request(app).get('/api/v1/auth/me').set(auth(created.key));
    expect(res.status).toBe(401);
  });

  it('revoking a key does NOT touch the owner\'s own session — they are independent credentials', async () => {
    const user = await makeUser(StaffRole.OWNER, 'revoke-independent');
    const token = signToken(user);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Independent' });
    const created = (createRes.body as CreatedKeyBody).data;

    await request(app).delete(`/api/v1/auth/me/api-keys/${created.id}`).set(auth(token));

    // The BROWSER SESSION that revoked the key must still work — revoking a
    // key is not the same action as signing out.
    const res = await request(app).get('/api/v1/auth/me').set(auth(token));
    expect(res.status).toBe(200);
  });

  it('is gone from the list after revocation, not shown as revoked', async () => {
    const user = await makeUser(StaffRole.OWNER, 'revoke-absent');
    const token = signToken(user);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Will disappear' });
    const created = (createRes.body as CreatedKeyBody).data;

    await request(app).delete(`/api/v1/auth/me/api-keys/${created.id}`).set(auth(token));

    const listRes = await request(app).get('/api/v1/auth/me/api-keys').set(auth(token));
    const body = listRes.body as ListBody;

    expect(body.data.find((k) => k.id === created.id)).toBeUndefined();
  });

  it('cannot revoke another user\'s key by guessing its id', async () => {
    const victim = await makeUser(StaffRole.OWNER, 'revoke-victim');
    const attacker = await makeUser(StaffRole.OWNER, 'revoke-attacker');
    const victimToken = signToken(victim);
    const attackerToken = signToken(attacker);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(victimToken))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'Victim key' });
    const created = (createRes.body as CreatedKeyBody).data;

    // 204 either way (idempotent), so the real assertion is that the
    // victim's key SURVIVES.
    await request(app)
      .delete(`/api/v1/auth/me/api-keys/${created.id}`)
      .set(auth(attackerToken));

    const res = await request(app).get('/api/v1/auth/me').set(auth(created.key));
    expect(res.status).toBe(200);
  });

  it('requires a session', async () => {
    const res = await request(app).delete('/api/v1/auth/me/api-keys/whatever');
    expect(res.status).toBe(401);
  });
});

describe('the soft ceiling on live keys per user', () => {
  it('refuses a 21st key with a clear message', async () => {
    const user = await makeUser(StaffRole.OWNER, 'ceiling');
    const token = signToken(user);

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/me/api-keys')
        .set(auth(token))
        .send({ purpose: 'Test integration', recipient: 'Test operator', name: `Key ${String(i)}` });
      expect(res.status).toBe(201);
    }

    const res = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ purpose: 'Test integration', recipient: 'Test operator', name: 'One too many' });

    expect(res.status).toBe(400);
  });
});
