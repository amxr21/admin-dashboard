import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { signToken } from '../services/auth.service.js';

/**
 * `GET /diagnostics/configuration` — the owner's configuration reference.
 *
 * This endpoint enumerates every integration secret BY NAME, so the property
 * worth pinning is what it refuses to include. A future change that adds "just
 * the host" or "the last four characters" to help someone debug would turn a
 * status page into an exfiltration tool, reachable over the network by any
 * real session. The response is asserted against the live secret VALUES, so
 * such a change fails here rather than in review.
 *
 * ISOLATION: users are namespaced with a run id and deleted in afterAll.
 */

const app = createApp();

const RUN = `diagconf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];

let developerToken = '';
let ownerToken = '';

async function makeUser(tag: string, role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${tag}@example.test`,
      name: `${RUN} ${tag}`,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return signToken(user);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  developerToken = await makeUser('developer', StaffRole.DEVELOPER);
  ownerToken = await makeUser('owner', StaffRole.OWNER);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('GET /api/v1/diagnostics/configuration', () => {
  it('never echoes a secret value, even though it names every secret', async () => {
    const res = await request(app)
      .get('/api/v1/diagnostics/configuration')
      .set(auth(developerToken));

    expect(res.status).toBe(200);

    const serialised = JSON.stringify(res.body);

    // Every secret this environment actually has set must be absent from the
    // payload. Empty/undefined vars are skipped: asserting on "" would pass
    // vacuously and hide a real leak of a configured one.
    const secrets = [
      env.JWT_SECRET,
      env.DELIVERY_CODE_SECRET,
      env.PASSWORD_RESET_SECRET,
      env.TWO_FACTOR_SECRET,
      env.API_KEY_SECRET,
      env.SMTP_PASSWORD,
      env.SMTP_USER,
      env.SMTP_HOST,
      env.CLOUDINARY_API_SECRET,
      env.CLOUDINARY_API_KEY,
      env.SENTRY_DSN,
      env.DATABASE_URL,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    for (const secret of secrets) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('reports the allowed origins as a COUNT, never the hostnames', async () => {
    const res = await request(app)
      .get('/api/v1/diagnostics/configuration')
      .set(auth(developerToken));

    const body = res.body as { data: { mode: { corsOriginCount: number } } };

    expect(body.data.mode.corsOriginCount).toBe(env.CORS_ORIGINS.length);

    const serialised = JSON.stringify(res.body);
    for (const origin of env.CORS_ORIGINS) {
      expect(serialised).not.toContain(origin);
    }
  });

  it('describes what breaks for anything unconfigured, so a name alone is never the whole row', async () => {
    const res = await request(app)
      .get('/api/v1/diagnostics/configuration')
      .set(auth(developerToken));

    const body = res.body as {
      data: { integrations: { key: string; configured: boolean; impact: string }[] };
    };

    expect(body.data.integrations.length).toBeGreaterThan(0);

    for (const integration of body.data.integrations) {
      expect(integration.impact.length).toBeGreaterThan(0);
      expect(typeof integration.configured).toBe('boolean');
    }
  });

  it('refuses an OWNER — operating the deployment is not a business area', async () => {
    // OWNER holds `*` over every AREA, which is exactly why this endpoint is
    // role-gated instead: an area check would hand it to them.
    const res = await request(app)
      .get('/api/v1/diagnostics/configuration')
      .set(auth(ownerToken));

    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/diagnostics/configuration');

    expect(res.status).toBe(401);
  });
});
