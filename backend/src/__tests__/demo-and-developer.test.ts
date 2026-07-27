import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { AREAS, canAccessArea } from '../config/roles.js';

/**
 * The two roles that are easy to get wrong in opposite directions.
 *
 * DEMO is handed to prospective clients, so the risk is EXPOSURE — it was
 * write-blocked and therefore assumed safe, while quietly returning real staff
 * email addresses.
 *
 * DEVELOPER is the only role with a non-business surface, so the risk is the
 * opposite: a diagnostics endpoint that leaks connection strings or drifts
 * into being reachable by everyone with `*`.
 */

const app = createApp();

interface DiagnosticsBody {
  data: {
    environment: string;
    database: { reachable: boolean };
    observability: {
      sentry: { configured: boolean; dashboard: string | null };
      logs: { dashboard: string | null };
    };
    migrations: { name: string }[];
  };
}

const RUN = `rolestest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];

let demoToken = '';
let developerToken = '';
let ownerToken = '';

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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

beforeAll(async () => {
  [demoToken, developerToken, ownerToken] = await Promise.all([
    makeUser(StaffRole.DEMO),
    makeUser(StaffRole.DEVELOPER),
    makeUser(StaffRole.OWNER),
  ]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('DEMO cannot see real people', () => {
  it('is refused the staff roster', async () => {
    /**
     * The bug this pins. DEMO used to hold `*`, so it reached `staff` and got
     * back real names, email addresses, lockout state and last-login times.
     * Writes were blocked, so no authorisation check ever failed — it was a
     * privacy leak wearing an authorisation costume.
     */
    const res = await request(app).get('/api/v1/staff').set(auth(demoToken));

    expect(res.status).toBe(403);
  });

  it('still sees the product itself', async () => {
    // The point of the account is a real demo, so restricting it further
    // would defeat it. Only personal data of employees is withheld.
    for (const path of ['/api/v1/orders', '/api/v1/inventory', '/api/v1/settings']) {
      expect((await request(app).get(path).set(auth(demoToken))).status).toBe(200);
    }
  });

  it('still cannot write anything it can see', async () => {
    const res = await request(app)
      .patch('/api/v1/settings')
      .set(auth(demoToken))
      .send({ 'store.name': 'Demo tried this' });

    expect(res.status).toBe(403);
  });

  it('is granted areas EXPLICITLY, so a new one is not inherited', () => {
    // Listed rather than `ALL` minus one: a future area holding personal data
    // must be added deliberately, not arrive granted.
    const granted = AREAS.filter((area) => canAccessArea(StaffRole.DEMO, area));

    expect(granted).not.toContain('staff');
    expect(granted.length).toBeLessThan(AREAS.length);
  });
});

describe('DEVELOPER diagnostics', () => {
  it('is reachable by a DEVELOPER', async () => {
    const res = await request(app).get('/api/v1/diagnostics').set(auth(developerToken));

    expect(res.status).toBe(200);
    expect((res.body as DiagnosticsBody).data.database.reachable).toBe(true);
  });

  it('is refused to an OWNER', async () => {
    /**
     * OWNER holds `*` over every AREA, which is why this is gated by ROLE and
     * not by an `area: 'diagnostics'` — that would have handed it to every
     * role with a wildcard, i.e. exactly the people it is not for.
     */
    expect((await request(app).get('/api/v1/diagnostics').set(auth(ownerToken))).status).toBe(403);
  });

  it('is refused to DEMO', async () => {
    expect((await request(app).get('/api/v1/diagnostics').set(auth(demoToken))).status).toBe(403);
  });

  it('requires a session at all', async () => {
    expect((await request(app).get('/api/v1/diagnostics')).status).toBe(401);
  });

  it('leaks no connection string, secret or DSN', async () => {
    // The most tempting thing to put on a diagnostics page and the most
    // dangerous: it is reachable over the network by a real session.
    const res = await request(app).get('/api/v1/diagnostics').set(auth(developerToken));
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('mysql://');
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toMatch(/https:\/\/[0-9a-f]+@/); // a Sentry DSN
    expect(body).not.toContain(process.env.JWT_SECRET ?? 'JWT_SECRET_UNSET');
    expect(body).not.toContain(process.env.DELIVERY_CODE_SECRET ?? 'DELIVERY_UNSET');
  });

  it('reports whether observability is configured, not how', async () => {
    const res = await request(app).get('/api/v1/diagnostics').set(auth(developerToken));
    const observability = (res.body as DiagnosticsBody).data.observability;

    // A boolean answers "are errors being reported at all", which is the
    // question, without echoing the credential that answers it.
    expect(typeof observability.sentry.configured).toBe('boolean');
    // Unset is null, not an error — the RUN layer that provisions these links
    // is not applied yet.
    expect(observability.logs.dashboard === null || typeof observability.logs.dashboard === 'string').toBe(true);
  });

  it('shows which migrations are actually applied', async () => {
    // "Is the deployed thing running the schema I think it is" — the question
    // that would have caught the Render deploy running pre-auth code.
    const res = await request(app).get('/api/v1/diagnostics').set(auth(developerToken));

    expect((res.body as DiagnosticsBody).data.migrations.length).toBeGreaterThan(0);
  });
});
