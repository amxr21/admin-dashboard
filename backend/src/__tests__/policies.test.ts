import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { waitFor } from './helpers/wait-for.js';

/**
 * Policy documents (B3.5) — Return/Privacy/Terms/Shipping, per locale,
 * versioned. The property worth pinning above all others: publishing never
 * overwrites a row, it always inserts a new `PolicyVersion` and repoints
 * `Policy.publishedVersionId` — so "what did this say last week" stays
 * answerable, and a revert creates ANOTHER new version rather than
 * resurrecting the old row's id.
 */

const app = createApp();

interface PublishBody {
  data: { id: string; version: number; content: string };
}
interface ListBody {
  data: { type: string; locale: string; version: number | null; content: string | null }[];
}
interface VersionsBody {
  data: { id: string; version: number; content: string }[];
}

const RUN = `policiestest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let ownerToken = '';
let supportToken = '';
let ownerId = '';

async function makeUser(role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return { id: user.id, token: signToken(user) };
}

beforeAll(async () => {
  const owner = await makeUser(StaffRole.OWNER);
  ownerToken = owner.token;
  ownerId = owner.id;
  supportToken = (await makeUser(StaffRole.SUPPORT)).token;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  // Every version this file created carries a `${RUN}` marker in its
  // content, so cleanup can find them regardless of which (type, locale)
  // pair a given test used, without a broader delete that could reach
  // policies another test (or a real admin) published.
  await prisma.policy.deleteMany({
    where: { publishedVersion: { content: { contains: RUN } } },
  });
  await prisma.policyVersion.deleteMany({ where: { content: { contains: RUN } } });
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

describe('GET /api/v1/policies', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/policies');
    expect(res.status).toBe(401);
  });

  it('rejects a role without the settings area', async () => {
    // SUPPORT does not hold `settings` per ROLE_AREAS.
    const res = await request(app).get('/api/v1/policies').set(auth(supportToken));
    expect(res.status).toBe(403);
  });

  it('lists every (type, locale) pair, including ones never published', async () => {
    const res = await request(app).get('/api/v1/policies').set(auth(ownerToken));
    expect(res.status).toBe(200);

    const body = (res.body as ListBody).data;
    // 4 types × 2 locales, always present regardless of publish state.
    expect(body).toHaveLength(8);
    expect(body.some((p) => p.type === 'RETURN' && p.locale === 'en')).toBe(true);
  });
});

describe('PUT /api/v1/policies/:type/:locale', () => {
  it('creates version 1 on first publish', async () => {
    const res = await request(app)
      .put('/api/v1/policies/RETURN/en')
      .set(auth(ownerToken))
      .send({ content: `${RUN} first return policy text` });

    expect(res.status).toBe(201);
    const body = (res.body as PublishBody).data;
    expect(body.version).toBe(1);
    expect(body.content).toBe(`${RUN} first return policy text`);
  });

  it('increments the version on a second publish rather than overwriting', async () => {
    await request(app)
      .put('/api/v1/policies/PRIVACY/en')
      .set(auth(ownerToken))
      .send({ content: `${RUN} privacy v1` });

    const second = await request(app)
      .put('/api/v1/policies/PRIVACY/en')
      .set(auth(ownerToken))
      .send({ content: `${RUN} privacy v2` });

    expect(second.status).toBe(201);
    expect((second.body as PublishBody).data.version).toBe(2);

    const history = await request(app)
      .get('/api/v1/policies/PRIVACY/en/versions')
      .set(auth(ownerToken));
    expect((history.body as VersionsBody).data.map((v) => v.version)).toEqual([2, 1]);
  });

  it('keeps different locales of the same type independent', async () => {
    await request(app)
      .put('/api/v1/policies/TERMS/en')
      .set(auth(ownerToken))
      .send({ content: `${RUN} terms en` });
    await request(app)
      .put('/api/v1/policies/TERMS/ar')
      .set(auth(ownerToken))
      .send({ content: `${RUN} terms ar` });

    const en = await request(app).get('/api/v1/policies/TERMS/en/versions').set(auth(ownerToken));
    const ar = await request(app).get('/api/v1/policies/TERMS/ar/versions').set(auth(ownerToken));

    expect((en.body as VersionsBody).data[0]?.version).toBe(1);
    expect((ar.body as VersionsBody).data[0]?.version).toBe(1);
    expect((en.body as VersionsBody).data[0]?.content).toBe(`${RUN} terms en`);
    expect((ar.body as VersionsBody).data[0]?.content).toBe(`${RUN} terms ar`);
  });

  it('rejects empty content', async () => {
    const res = await request(app)
      .put('/api/v1/policies/SHIPPING/en')
      .set(auth(ownerToken))
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported locale', async () => {
    const res = await request(app)
      .put('/api/v1/policies/SHIPPING/fr')
      .set(auth(ownerToken))
      .send({ content: `${RUN} x` });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid policy type', async () => {
    const res = await request(app)
      .put('/api/v1/policies/NOT_A_TYPE/en')
      .set(auth(ownerToken))
      .send({ content: `${RUN} x` });
    expect(res.status).toBe(400);
  });

  it('logs a "policy.published" audit entry', async () => {
    await request(app)
      .put('/api/v1/policies/RETURN/ar')
      .set(auth(ownerToken))
      .send({ content: `${RUN} audited return ar` });

    const entry = await waitFor(() =>
      prisma.auditLog.findFirst({
        where: { action: 'policy.published', actorId: ownerId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(entry?.entity).toBe('policy');
  });
});

describe('POST /api/v1/policies/:type/:locale/revert', () => {
  it('creates a NEW version carrying the old content, rather than resurrecting the old row', async () => {
    const first = await request(app)
      .put('/api/v1/policies/SHIPPING/ar')
      .set(auth(ownerToken))
      .send({ content: `${RUN} shipping v1` });
    await request(app)
      .put('/api/v1/policies/SHIPPING/ar')
      .set(auth(ownerToken))
      .send({ content: `${RUN} shipping v2` });

    const firstId = (first.body as PublishBody).data.id;

    const reverted = await request(app)
      .post('/api/v1/policies/SHIPPING/ar/revert')
      .set(auth(ownerToken))
      .send({ versionId: firstId });

    expect(reverted.status).toBe(201);
    const body = (reverted.body as PublishBody).data;
    expect(body.version).toBe(3);
    expect(body.content).toBe(`${RUN} shipping v1`);
    expect(body.id).not.toBe(firstId);
  });

  it('404s a version id from a different (type, locale) pair', async () => {
    const returnVersion = await request(app)
      .put('/api/v1/policies/RETURN/en')
      .set(auth(ownerToken))
      .send({ content: `${RUN} cross-type source` });

    const res = await request(app)
      .post('/api/v1/policies/PRIVACY/en/revert')
      .set(auth(ownerToken))
      .send({ versionId: (returnVersion.body as PublishBody).data.id });

    expect(res.status).toBe(404);
  });

  it('404s an unknown version id', async () => {
    const res = await request(app)
      .post('/api/v1/policies/RETURN/en/revert')
      .set(auth(ownerToken))
      .send({ versionId: 'not-a-real-id' });
    expect(res.status).toBe(404);
  });
});
