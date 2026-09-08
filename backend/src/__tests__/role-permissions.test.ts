import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { clearRolePermissionCache } from '../services/role-permissions.service.js';

/**
 * Owner-editable role permissions (O8).
 *
 * ─── WHY THE GUARDS ARE THE POINT ────────────────────────────────────
 * This feature hands an owner the ability to change what every role can
 * reach, which makes it the single most dangerous screen in the app. The
 * three rules below are what stop it from being a way to lock everyone out or
 * to escalate:
 *
 * 1. OWNER and DEVELOPER can never be narrowed. An owner who unticked their
 *    own `settings` box would lose the very screen that ticks it back, and
 *    recovery would need database access. Enforced in the SERVICE, so even a
 *    hand-written row is ignored.
 * 2. Only OWNER/DEVELOPER may edit. Not `requireArea('settings')` — MANAGER
 *    holds that today, and a role that can widen its own permissions has no
 *    permissions at all.
 * 3. Removing an area actually DENIES it. Without this the feature is
 *    cosmetic: the matrix saves, the link disappears, and the endpoint still
 *    answers.
 */

const app = createApp();

const RUN = `roleperm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const userIds: string[] = [];

let ownerToken = '';
let managerToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

async function makeUser(role: StaffRole, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: `${RUN} ${label}`,
      role,
      passwordHash: await bcrypt.hash('correct-horse-battery-staple', 10),
    },
  });
  userIds.push(user.id);
  return user;
}

beforeAll(async () => {
  const [owner, manager] = await Promise.all([
    makeUser(StaffRole.OWNER, 'owner'),
    makeUser(StaffRole.MANAGER, 'manager'),
  ]);

  ownerToken = signToken(owner);
  managerToken = signToken(manager);
});

afterEach(async () => {
  // Every test starts from the shipped defaults. The cache is cleared too, or
  // the next test reads a set this one wrote.
  await prisma.rolePermission.deleteMany({});
  clearRolePermissionCache();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('who may change permissions', () => {
  it('refuses a MANAGER, despite their `settings` access', () => {
    // A role that can widen its own permissions has none. If this ever
    // passes, the route has been moved onto requireArea('settings').
    return request(app)
      .put('/api/v1/roles/SUPPORT/areas')
      .set(auth(managerToken))
      .send({ areas: ['orders'] })
      .expect(403);
  });

  it('refuses an unauthenticated request', () =>
    request(app).put('/api/v1/roles/SUPPORT/areas').send({ areas: [] }).expect(401));

  it('lets an OWNER change a role', async () => {
    const res = await request(app)
      .put('/api/v1/roles/SUPPORT/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders', 'returns'] });

    expect(res.status).toBe(200);
    expect((res.body as { data: { areas: string[] } }).data.areas.sort()).toEqual([
      'orders',
      'returns',
    ]);
  });
});

describe('OWNER and DEVELOPER can never be narrowed', () => {
  it('refuses to edit OWNER', async () => {
    const res = await request(app)
      .put('/api/v1/roles/OWNER/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders'] });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/full access/i);
  });

  it('refuses to edit DEVELOPER', async () => {
    const res = await request(app)
      .put('/api/v1/roles/DEVELOPER/areas')
      .set(auth(ownerToken))
      .send({ areas: [] });

    expect(res.status).toBe(400);
  });

  it('IGNORES a hand-written row for a locked role', async () => {
    // Enforced on READ as well as write, so a direct INSERT — a migration, a
    // restored backup, somebody at a database console — cannot lock everyone
    // out of their own system.
    await prisma.rolePermission.create({
      data: { role: StaffRole.OWNER, areas: ['orders'] },
    });
    clearRolePermissionCache();

    // The owner can still reach settings, which the row says they cannot.
    const res = await request(app).get('/api/v1/settings').set(auth(ownerToken));

    expect(res.status).toBe(200);
  });
});

describe('a removed area is actually denied', () => {
  it('stops the role reaching the endpoint', async () => {
    // The rule that makes this feature real rather than cosmetic. Uses a
    // route that is genuinely behind `requireArea` — `GET /settings` is not
    // (only the PATCH is), so asserting against it would have proved nothing.
    const before = await request(app).get('/api/v1/reports/overview?from=2026-01-01&to=2026-12-31').set(auth(managerToken));
    expect(before.status).toBe(200);

    await request(app)
      .put('/api/v1/roles/MANAGER/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders'] })
      .expect(200);

    const after = await request(app).get('/api/v1/reports/overview?from=2026-01-01&to=2026-12-31').set(auth(managerToken));
    expect(after.status).toBe(403);
  });

  it('takes effect without signing anyone out', async () => {
    // The owner's decision: changes apply on the next request, not by
    // revoking sessions. The SAME token keeps working for what is still
    // allowed.
    await request(app)
      .put('/api/v1/roles/MANAGER/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders'] })
      .expect(200);

    // Still authenticated — just narrower.
    const stillFine = await request(app).get('/api/v1/orders').set(auth(managerToken));
    expect(stillFine.status).not.toBe(401);
  });

  it('can GRANT an area a role does not have by default', async () => {
    // Both directions. SUPPORT has no `reports` in the shipped defaults, so
    // this proves the override widens as well as narrows.
    const support = await makeUser(StaffRole.SUPPORT, `grant-${Date.now()}`);
    const supportToken = signToken(support);

    const before = await request(app)
      .get('/api/v1/reports/overview?from=2026-01-01&to=2026-12-31')
      .set(auth(supportToken));
    expect(before.status).toBe(403);

    await request(app)
      .put('/api/v1/roles/SUPPORT/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders', 'returns', 'reports'] })
      .expect(200);

    const after = await request(app).get('/api/v1/reports/overview?from=2026-01-01&to=2026-12-31').set(auth(supportToken));
    expect(after.status).toBe(200);
  });
});

describe('defaults and resets', () => {
  it('a role with no row keeps its shipped default', async () => {
    // The whole additive premise: shipping this granted nobody anything.
    const res = await request(app).get('/api/v1/roles').set(auth(ownerToken));

    const support = (
      res.body as { data: { roles: { role: string; areas: string[]; isCustomised: boolean }[] } }
    ).data.roles.find((entry) => entry.role === 'SUPPORT');

    expect(support?.isCustomised).toBe(false);
    expect(support?.areas).toContain('orders');
  });

  it('reports a customised role as such', async () => {
    await request(app)
      .put('/api/v1/roles/SUPPORT/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders'] });

    const res = await request(app).get('/api/v1/roles').set(auth(ownerToken));

    const support = (
      res.body as { data: { roles: { role: string; isCustomised: boolean }[] } }
    ).data.roles.find((entry) => entry.role === 'SUPPORT');

    // Visible, so "why can Support not see returns any more" has an answer.
    expect(support?.isCustomised).toBe(true);
  });

  it('reset returns the role to the shipped default', async () => {
    // A real action, not "tick everything back": the defaults change between
    // releases, and a manual reset would freeze the role at today's version.
    await request(app)
      .put('/api/v1/roles/SUPPORT/areas')
      .set(auth(ownerToken))
      .send({ areas: [] });

    const res = await request(app)
      .delete('/api/v1/roles/SUPPORT/areas')
      .set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect((res.body as { data: { areas: string[] } }).data.areas).toContain('orders');
  });

  it('accepts an EMPTY set as a real choice', async () => {
    // "This role reaches nothing" is a deliberate state, and is exactly why
    // absence has to mean "use the default" rather than "empty".
    await request(app)
      .put('/api/v1/roles/DEMO/areas')
      .set(auth(ownerToken))
      .send({ areas: [] })
      .expect(200);

    const res = await request(app).get('/api/v1/roles').set(auth(ownerToken));

    const demo = (
      res.body as { data: { roles: { role: string; areas: string[] }[] } }
    ).data.roles.find((entry) => entry.role === 'DEMO');

    expect(demo?.areas).toEqual([]);
  });

  it('refuses an unknown area rather than silently dropping it', async () => {
    // Filtering would save a set the owner did not choose and show it back as
    // though they had.
    const res = await request(app)
      .put('/api/v1/roles/SUPPORT/areas')
      .set(auth(ownerToken))
      .send({ areas: ['orders', 'not-an-area'] });

    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/not-an-area/);
  });

  it('404s an unknown role', () =>
    request(app)
      .put('/api/v1/roles/WIZARD/areas')
      .set(auth(ownerToken))
      .send({ areas: [] })
      .expect(404));
});
