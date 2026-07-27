import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { StaffRole } from '@prisma/client';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { signToken } from '../services/auth.service.js';
import { assertCanWrite } from '../middleware/authorize.js';
import { AREAS, areasFor, canAccessArea, isReadOnlyRole } from '../config/roles.js';

/**
 * RBAC is the highest-risk surface in the API: a gap here means one staff
 * member reading or changing something that belongs to another function.
 *
 * The demo-role tests matter most. That account is handed to prospective
 * clients — it must be provably incapable of changing anything.
 */

const app = createApp();

const RUN = `rbactest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct-horse-battery-staple';
const createdUserIds: string[] = [];

async function makeUser(role: StaffRole) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${role.toLowerCase()}@example.test`,
      name: role,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  createdUserIds.push(user.id);
  return { user, token: signToken(user) };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('role → area map', () => {
  it('grants OWNER and DEVELOPER every area', () => {
    for (const area of AREAS) {
      expect(canAccessArea(StaffRole.OWNER, area)).toBe(true);
      expect(canAccessArea(StaffRole.DEVELOPER, area)).toBe(true);
    }
  });

  it('withholds staff management from MANAGER', () => {
    // Hiring and access control stay with the owner. If this ever flips, a
    // manager could grant themselves OWNER.
    expect(canAccessArea(StaffRole.MANAGER, 'staff')).toBe(false);
    expect(canAccessArea(StaffRole.MANAGER, 'orders')).toBe(true);
  });

  it('restricts SUPPORT to its own areas', () => {
    expect(canAccessArea(StaffRole.SUPPORT, 'orders')).toBe(true);
    expect(canAccessArea(StaffRole.SUPPORT, 'customers')).toBe(true);
    // Support must not be able to change pricing or issue discounts.
    expect(canAccessArea(StaffRole.SUPPORT, 'discounts')).toBe(false);
    expect(canAccessArea(StaffRole.SUPPORT, 'settings')).toBe(false);
    expect(canAccessArea(StaffRole.SUPPORT, 'staff')).toBe(false);
  });

  it('restricts FULFILLMENT to its own areas', () => {
    expect(canAccessArea(StaffRole.FULFILLMENT, 'delivery')).toBe(true);
    expect(canAccessArea(StaffRole.FULFILLMENT, 'orders')).toBe(true);
    expect(canAccessArea(StaffRole.FULFILLMENT, 'reports')).toBe(false);
    expect(canAccessArea(StaffRole.FULFILLMENT, 'staff')).toBe(false);
  });

  it('lets DEMO see every area EXCEPT staff', () => {
    /**
     * This used to assert total visibility, on the reasoning that the demo
     * account is a realistic tour and writes are blocked separately.
     *
     * That was wrong, and the test was documenting the mistake: `staff`
     * returns real employees — names, email addresses, who is locked out,
     * when each last signed in — and the demo account is handed to
     * PROSPECTIVE CLIENTS. Nothing was writable, so no authorisation check
     * ever failed. It was a privacy leak, not an authorisation bug, which is
     * why a write-focused rule never caught it.
     */
    for (const area of AREAS) {
      expect(canAccessArea(StaffRole.DEMO, area)).toBe(area !== 'staff');
    }
  });

  it('grants DEMO its areas explicitly, so a new one is not inherited', () => {
    // Listed rather than a wildcard minus one: a future area holding personal
    // data has to be added deliberately instead of arriving granted.
    expect(canAccessArea(StaffRole.DEMO, 'staff')).toBe(false);
  });

  it('marks only DEMO as read-only', () => {
    expect(isReadOnlyRole(StaffRole.DEMO)).toBe(true);
    expect(isReadOnlyRole(StaffRole.OWNER)).toBe(false);
    expect(isReadOnlyRole(StaffRole.SUPPORT)).toBe(false);
  });

  it('expands a wildcard grant to the full area list', () => {
    expect(areasFor(StaffRole.OWNER)).toEqual(AREAS);
    expect(areasFor(StaffRole.SUPPORT)).not.toEqual(AREAS);
  });
});

describe('demo account cannot write — the choke-point guard', () => {
  /**
   * These drive `assertCanWrite` directly rather than through HTTP.
   *
   * The guard lives inside `authenticate`, so it only runs on routes that
   * mount `authenticate` — which is the correct guarantee ("every
   * authenticated route is write-protected"), but it means a request to a
   * non-existent path 404s at `notFoundHandler` before any guard runs. Testing
   * it over HTTP would need a fake write route in production code.
   *
   * There is one real integration case below (login), and the first genuine
   * write route in a later group should add another.
   */
  function fakeRequest(method: string, role: StaffRole | null): Request {
    return {
      method,
      path: '/api/v1/anything',
      user: role === null ? undefined : { role },
      log: { warn: () => undefined },
    } as unknown as Request;
  }

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('blocks %s for DEMO', (method) => {
    // Every write verb, not just the convenient one. A guard covering only
    // POST is a guard with a DELETE-shaped hole.
    expect(() => assertCanWrite(fakeRequest(method, StaffRole.DEMO))).toThrow(
      /read-only demo/i,
    );
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s for DEMO', (method) => {
    // A demo account that cannot read is useless — the point is a full,
    // realistic tour of real data.
    expect(() => assertCanWrite(fakeRequest(method, StaffRole.DEMO))).not.toThrow();
  });

  it.each([StaffRole.OWNER, StaffRole.MANAGER, StaffRole.SUPPORT, StaffRole.FULFILLMENT])(
    'does NOT block writes for %s',
    (role) => {
      // Guards against the block being too broad and breaking every real user.
      expect(() => assertCanWrite(fakeRequest('POST', role))).not.toThrow();
    },
  );

  it('ignores unauthenticated requests', () => {
    // Public routes have no user. The guard must not throw on them, or login
    // itself would break.
    expect(() => assertCanWrite(fakeRequest('POST', null))).not.toThrow();
  });

  it('still allows DEMO to read over HTTP', async () => {
    const demo = await prisma.user.create({
      data: {
        email: `${RUN}-demo-read@example.test`,
        role: StaffRole.DEMO,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
    });
    createdUserIds.push(demo.id);

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signToken(demo)}`);

    expect(res.status).toBe(200);
  });

  it('lets a DEMO account log in normally', async () => {
    // Login is a POST. If the write-block were applied before role checks it
    // would lock demo users out of their own account entirely.
    const demo = await prisma.user.create({
      data: {
        email: `${RUN}-demo-login@example.test`,
        role: StaffRole.DEMO,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
    });
    createdUserIds.push(demo.id);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: demo.email, password: PASSWORD });

    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/roles', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/roles');
    expect(res.status).toBe(401);
  });

  it('returns every role with its areas and read-only flag', async () => {
    const { token } = await makeUser(StaffRole.SUPPORT);

    const res = await request(app)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${token}`);

    const body = res.body as {
      data: { roles: { role: string; readOnly: boolean }[]; areas: string[] };
    };

    expect(res.status).toBe(200);
    expect(body.data.roles).toHaveLength(Object.keys(StaffRole).length);
    expect(body.data.areas).toEqual([...AREAS]);
    expect(body.data.roles.find((r) => r.role === 'DEMO')?.readOnly).toBe(true);
  });

  it('reports the caller’s own permissions at /roles/me', async () => {
    const { token } = await makeUser(StaffRole.FULFILLMENT);

    const res = await request(app)
      .get('/api/v1/roles/me')
      .set('Authorization', `Bearer ${token}`);

    const body = res.body as { data: { role: string; areas: string[]; readOnly: boolean } };

    expect(res.status).toBe(200);
    expect(body.data.role).toBe('FULFILLMENT');
    expect(body.data.readOnly).toBe(false);
    expect(body.data.areas).toContain('delivery');
    expect(body.data.areas).not.toContain('staff');
  });
});
