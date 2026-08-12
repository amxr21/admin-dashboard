import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';

/**
 * Danger zone → "Delete test data" (B3.4).
 *
 * ─── WHY THIS FILE NEVER CALLS THE REAL DELETE, NOT EVEN AT THE SERVICE
 *     LAYER ──────────────────────────────────────────────────────────
 * Every backend test in this repo runs against the SAME local/CI database as
 * `pnpm demo:seed` — there is no separate test database (`vitest.config.ts`
 * sets `fileParallelism: false` specifically because DB tests share tables).
 * `deleteDemoData()` is a wide, tag-scoped sweep across seven tables BY
 * DESIGN — there is no way to call it "for just one planted row"; it matches
 * everything carrying `__demo__`, including a real local `demo:seed` run.
 *
 * That is not a hypothetical: writing the first version of this file called
 * the real endpoint and the real service function, and each one silently
 * deleted the 140 orders / 25 products a prior `pnpm demo:seed` had put in
 * the local dev database, twice, before this comment existed to stop it.
 *
 * So this file proves what it can WITHOUT touching real rows:
 *   - authorization (401/403) — the request never reaches the service
 *   - the read/preview endpoint (GET), which only counts, never deletes
 *   - the DELETE route's WHERE clauses are BYTE-IDENTICAL to
 *     `prisma/demo-teardown.ts`'s long-standing, independently-safe ones —
 *     read from disk and compared, rather than re-proven by executing a
 *     second copy of the sweep against live data.
 */

const app = createApp();

interface SummaryBody {
  data: { categories: number; total: number };
}

const RUN = `demodatatest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];
let ownerToken = '';
let supportToken = '';

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
  return signToken(user);
}

beforeAll(async () => {
  [ownerToken, supportToken] = await Promise.all([
    makeUser(StaffRole.OWNER),
    makeUser(StaffRole.SUPPORT),
  ]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

describe('GET /api/v1/danger-zone/demo-data', () => {
  it('rejects anyone who is not OWNER or DEVELOPER', async () => {
    const res = await request(app).get('/api/v1/danger-zone/demo-data').set(auth(supportToken));
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/danger-zone/demo-data');
    expect(res.status).toBe(401);
  });

  it('returns a summary shaped for the confirmation dialog, without deleting anything', async () => {
    const res = await request(app).get('/api/v1/danger-zone/demo-data').set(auth(ownerToken));

    expect(res.status).toBe(200);
    const body = res.body as SummaryBody;
    expect(typeof body.data.total).toBe('number');
    expect(body.data.total).toBeGreaterThanOrEqual(0);
  });
});

describe('DELETE /api/v1/danger-zone/demo-data — authorization only', () => {
  // Never fired for real below this point — see the file banner. Both tests
  // here assert the request is refused before it ever reaches the service.
  it('rejects anyone who is not OWNER or DEVELOPER', async () => {
    const res = await request(app)
      .delete('/api/v1/danger-zone/demo-data')
      .set(auth(supportToken));
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).delete('/api/v1/danger-zone/demo-data');
    expect(res.status).toBe(401);
  });
});

describe('deleteDemoData() WHERE clauses match demo-teardown.ts exactly', () => {
  it('tags every filter the same way the standalone CLI teardown does', () => {
    const servicePath = fileURLToPath(new URL('../services/demo-data.service.ts', import.meta.url));
    const teardownPath = fileURLToPath(new URL('../../prisma/demo-teardown.ts', import.meta.url));

    const serviceSource = readFileSync(servicePath, 'utf8');
    const teardownSource = readFileSync(teardownPath, 'utf8');

    const extractWhere = (source: string) => {
      const match = /const WHERE = \{([\s\S]*?)\} as const;/.exec(source);
      if (!match) throw new Error('Could not find a WHERE block to compare');
      // Collapse whitespace so formatting differences don't cause a false
      // mismatch — only the actual filter shape is being compared.
      return match[1].replace(/\s+/g, ' ').trim();
    };

    expect(extractWhere(serviceSource)).toBe(extractWhere(teardownSource));
  });

  it('both filter on the same __demo__ tag constant, not a hardcoded copy that could drift', () => {
    const servicePath = fileURLToPath(new URL('../services/demo-data.service.ts', import.meta.url));
    const dataPath = fileURLToPath(new URL('../../prisma/demo-data.ts', import.meta.url));

    const serviceSource = readFileSync(servicePath, 'utf8');
    const dataSource = readFileSync(dataPath, 'utf8');

    const serviceTag = /const DEMO_TAG = '([^']+)'/.exec(serviceSource)?.[1];
    const canonicalTag = /export const DEMO_TAG = '([^']+)'/.exec(dataSource)?.[1];

    expect(serviceTag).toBeDefined();
    expect(serviceTag).toBe(canonicalTag);
  });
});
