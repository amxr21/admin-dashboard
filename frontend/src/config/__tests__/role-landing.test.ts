import { describe, expect, it } from 'vitest';

import { AREAS, ROLE_LANDING, canAccessArea, landingFor, type Area } from '../areas';

/**
 * Where each role lands after signing in (O3.2 / F5.4).
 *
 * ─── THE ASSERTION THAT MATTERS ──────────────────────────────────────
 * Every landing page must be inside the role's OWN grant. Getting this wrong
 * replaces a confusing first screen with a 403 on login, which is strictly
 * worse than the problem it set out to fix — and it is the kind of mistake
 * that survives review, because the map reads as obviously sensible right up
 * until someone narrows a role's areas and forgets this file exists.
 *
 * So the check is derived from `ROLE_AREAS` rather than hard-coded: narrowing
 * a role's grant without moving its landing page fails HERE, at the source of
 * the contradiction, instead of on a real login.
 */

/** Which area a landing route belongs to. `/admin` is the dashboard, which
 *  every role may open — it is the shell's own home, not an area. */
const ROUTE_AREA: Record<string, Area | null> = {
  '/admin': null,
  '/admin/orders': 'orders',
  '/admin/returns': 'returns',
  '/admin/inventory': 'inventory',
  '/admin/delivery': 'delivery',
  '/admin/reports': 'reports',
};

describe('role landing pages', () => {
  it('sends every role somewhere it is allowed to be', () => {
    for (const [role, route] of Object.entries(ROLE_LANDING)) {
      // An unmapped route means someone added a landing page without telling
      // this test what it needs — fail loudly rather than skip it silently.
      expect(Object.keys(ROUTE_AREA)).toContain(route);

      const area = ROUTE_AREA[route] ?? null;

      if (area !== null) {
        expect(
          canAccessArea(role as keyof typeof ROLE_LANDING, area),
          `${role} lands on ${route} but has no '${area}' grant`,
        ).toBe(true);
      }
    }
  });

  it('does not send a role with no reports access to the revenue dashboard', () => {
    // The whole point of O3: FULFILLMENT and SUPPORT were opening on a page
    // built to answer a question they are not allowed to ask, and whose every
    // widget 403s behind `requireArea('reports')`.
    for (const role of ['FULFILLMENT', 'SUPPORT'] as const) {
      expect(canAccessArea(role, 'reports')).toBe(false);
      expect(ROLE_LANDING[role]).not.toBe('/admin');
    }
  });

  it('keeps the dashboard for roles that can actually read it', () => {
    for (const role of ['OWNER', 'DEVELOPER', 'MANAGER'] as const) {
      expect(canAccessArea(role, 'reports')).toBe(true);
      expect(ROLE_LANDING[role]).toBe('/admin');
    }
  });

  it('covers every role, so a new one cannot be forgotten', () => {
    // A role missing from the map would fall back to '/admin' via
    // `landingFor` — silently reintroducing the exact bug for the new role.
    const roles = ['DEVELOPER', 'OWNER', 'MANAGER', 'FULFILLMENT', 'SUPPORT', 'DEMO'] as const;

    for (const role of roles) {
      expect(ROLE_LANDING[role]).toBeDefined();
    }
    expect(Object.keys(ROLE_LANDING).sort()).toEqual([...roles].sort());
  });

  it('falls back to the dashboard for an unknown role rather than crashing', () => {
    // Defensive: an enum value added server-side and not here must degrade to
    // the old behaviour, not to a blank redirect.
    expect(landingFor('NOT_A_ROLE' as keyof typeof ROLE_LANDING)).toBe('/admin');
  });

  it('names only areas that exist', () => {
    for (const area of Object.values(ROUTE_AREA)) {
      if (area !== null) expect(AREAS).toContain(area);
    }
  });
});
