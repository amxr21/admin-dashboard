import type { Request, Response, NextFunction } from 'express';
import { StaffRole } from '@prisma/client';

import { AppError } from '../errors/AppError.js';
import { canAccessArea, isReadOnlyRole, type Area } from '../config/roles.js';
import { getSettingValue } from '../services/settings.service.js';
import { requireUser } from './authenticate.js';

/**
 * Authorisation middleware. Always mounted AFTER `authenticate`.
 *
 * Per code-standards, authorisation runs before handler logic — never as a
 * check buried inside the handler, which is how routes ship unprotected.
 */

/** HTTP methods that only read. Everything else counts as a write. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Throws if a read-only role (currently DEMO) is attempting a write.
 *
 * ─── WHY THIS IS METHOD-BASED, NOT PER-ROUTE ──────────────────────────
 * The obvious implementation is a `canWrite` check inside each write handler.
 * That fails the moment someone adds a route and forgets it — and the failure
 * is SILENT, because the demo user simply succeeds.
 *
 * Deny-by-default on the HTTP method inverts that: a new POST/PATCH/DELETE
 * route is read-only for demo accounts the instant it exists, with nobody
 * remembering anything. Granting a write requires a deliberate exemption.
 *
 * ─── WHY IT LIVES INSIDE `authenticate`, NOT AS APP-LEVEL MIDDLEWARE ──
 * It depends on `req.user`, which `authenticate` populates inside each route.
 * Mounting it at app level in app.ts would run it BEFORE any route's
 * `authenticate`, so `req.user` would always be undefined and every write
 * would pass through unchecked — a silent authorisation bypass.
 *
 * Coupling it to `authenticate` makes the ordering impossible to get wrong:
 * identity and the restrictions that follow from identity are established
 * together.
 */
export function assertCanWrite(req: Request): void {
  const user = req.user;

  // No user means a public route — nothing to restrict.
  if (!user) return;

  if (READ_METHODS.has(req.method) || !isReadOnlyRole(user.role)) return;

  req.log.warn({
    event: 'authz.write.blocked',
    role: user.role,
    method: req.method,
    path: req.path,
  });

  throw AppError.forbidden('This is a read-only demo account. Changes are disabled.');
}

/**
 * Throws if `system.maintenanceMode` is on and this write isn't exempt.
 *
 * OWNER and DEVELOPER are exempt on purpose: someone has to be able to turn
 * the setting back off, and locking out the two roles capable of doing that
 * would make maintenance mode a one-way door.
 *
 * Async, unlike `assertCanWrite` — the value lives in the database, not on
 * the token — so it runs from `authenticate` as a second, separate check
 * rather than being folded into that synchronous one.
 */
export async function assertNotInMaintenance(req: Request): Promise<void> {
  const user = req.user;

  if (!user) return;
  if (READ_METHODS.has(req.method)) return;
  if (user.role === StaffRole.OWNER || user.role === StaffRole.DEVELOPER) return;

  const maintenanceMode = await getSettingValue('system.maintenanceMode');
  if (!maintenanceMode) return;

  req.log.warn({
    event: 'authz.write.blocked.maintenance',
    role: user.role,
    method: req.method,
    path: req.path,
  });

  throw AppError.serviceUnavailable(
    'The system is in maintenance mode. Try again shortly.',
  );
}

/**
 * Requires the caller's role to grant access to `area`.
 *
 * IMPORTANT: this is a coarse gate — it answers "may this role touch orders at
 * all", not "may this user touch THIS order". Per-record ownership checks are
 * a separate concern and belong at the top of the handler, in the same query
 * that loads the record. Passing this middleware is not authorisation on its
 * own for any route that takes a record id.
 */
export function requireArea(area: Area) {
  return function areaGuard(req: Request, _res: Response, next: NextFunction): void {
    try {
      const user = requireUser(req);

      if (!canAccessArea(user.role, area)) {
        req.log.warn({
          event: 'authz.area.denied',
          role: user.role,
          area,
          method: req.method,
          path: req.path,
        });

        // 403, not 404. The caller is authenticated and this resource exists —
        // pretending otherwise makes legitimate permission problems
        // undebuggable for support staff.
        throw AppError.forbidden('You do not have access to this area');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Requires one of an explicit set of roles.
 *
 * Use sparingly — `requireArea` is preferable because it describes intent
 * ("this touches billing") rather than a hardcoded list that has to be updated
 * every time a role is added. Reserve this for genuinely role-specific
 * surfaces such as developer diagnostics.
 */
export function requireRole(...roles: readonly StaffRole[]) {
  return function roleGuard(req: Request, _res: Response, next: NextFunction): void {
    try {
      const user = requireUser(req);

      if (!roles.includes(user.role)) {
        req.log.warn({
          event: 'authz.role.denied',
          role: user.role,
          required: roles,
          path: req.path,
        });
        throw AppError.forbidden('You do not have access to this resource');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
