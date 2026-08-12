import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * API keys (B3.2).
 *
 * The load-bearing property across this file: a key authenticates as its
 * OWNER, exactly — no separate scope of its own. So the tests that matter
 * most are really about that inheritance being exact: a SUPPORT-owned key
 * can do what SUPPORT can and nothing more, and revoking a key must not
 * touch the owner's own session (they are two independent credentials for
 * the same person, not one revoking the other).
 */

const app = createApp();

const RUN = `apikeytest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct-horse-battery-staple';
const createdUserIds: string[] = [];

interface CreatedKeyBody {
  data: { id: string; name: string; key: string };
}
interface ListBody {
  data: { id: string; name: string; keyPreview: string; lastUsedAt: string | null }[];
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
      .send({ name: 'CI pipeline' });

    expect(res.status).toBe(201);
    const body = res.body as CreatedKeyBody;
    expect(body.data.key).toMatch(/^adk_/);
    expect(body.data.name).toBe('CI pipeline');
  });

  it('never returns the plaintext again from the list endpoint', async () => {
    const user = await makeUser(StaffRole.OWNER, 'no-leak');
    const token = signToken(user);

    await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ name: 'Leak check' });

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
      .send({ name: 'Owner key' });
    await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(otherToken))
      .send({ name: 'Other key' });

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
      .send({ name: '' });

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
      .send({ name: 'Read test' });
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
      .send({ name: 'Support key' });
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
      .send({ name: 'Will be deactivated' });
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
      .send({ name: 'Tracks last used' });
    const key = (createRes.body as CreatedKeyBody).data.key;

    await request(app).get('/api/v1/auth/me').set(auth(key));

    const listRes = await request(app).get('/api/v1/auth/me/api-keys').set(auth(token));
    const body = listRes.body as ListBody;
    const found = body.data.find((k) => k.name === 'Tracks last used');

    expect(found?.lastUsedAt).toBeTruthy();
  });
});

describe('revoking a key', () => {
  it('a revoked key can no longer authenticate', async () => {
    const user = await makeUser(StaffRole.OWNER, 'revoke');
    const token = signToken(user);

    const createRes = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ name: 'To be revoked' });
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
      .send({ name: 'Independent' });
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
      .send({ name: 'Will disappear' });
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
      .send({ name: 'Victim key' });
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
        .send({ name: `Key ${String(i)}` });
      expect(res.status).toBe(201);
    }

    const res = await request(app)
      .post('/api/v1/auth/me/api-keys')
      .set(auth(token))
      .send({ name: 'One too many' });

    expect(res.status).toBe(400);
  });
});
