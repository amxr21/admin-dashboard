import type { Request, Response, NextFunction } from 'express';
import { StaffRole } from '@prisma/client';

import { AppError } from '../errors/AppError.js';
import { canAccessArea, isReadOnlyRole, type Area } from '../config/roles.js';
import { getSettingValue } from '../services/settings.service.js';
import { auditDenied } from '../services/audit.service.js';
import { isIpAllowed, parseAllowlist } from '../lib/ip-allowlist.js';
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

  auditDenied(req, {
    action: 'authz.write.blocked',
    entity: 'authz',
    changes: { role: user.role, method: req.method, path: req.path },
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

  auditDenied(req, {
    action: 'authz.write.blocked.maintenance',
    entity: 'authz',
    changes: { role: user.role, method: req.method, path: req.path },
  });

  throw AppError.serviceUnavailable(
    'The system is in maintenance mode. Try again shortly.',
  );
}

/**
 * Throws if `security.ipAllowlist` is non-empty and the caller's IP matches
 * none of its entries.
 *
 * ─── SAFETY RAILS (asked and confirmed before building) ───────────────
 * 1. OWNER and DEVELOPER always bypass this, unconditionally — a wrong CIDR
 *    entered by the very person configuring it must never lock out the only
 *    two roles capable of fixing the setting. Same reasoning as
 *    `assertNotInMaintenance`'s exemption for the same two roles.
 * 2. Empty list = disabled. This is the setting's default, so a fresh
 *    install or an admin who never touches this screen is never affected.
 * 3. An unparseable `req.ip` (no honest answer — see audit.service.ts's
 *    `requestContext` for the same situation) is treated as NOT matching,
 *    the safe failure for "cannot even evaluate the rule" — but that only
 *    matters when the list is non-empty in the first place.
 */
export async function assertIpAllowed(req: Request): Promise<void> {
  const user = req.user;

  if (!user) return;
  if (user.role === StaffRole.OWNER || user.role === StaffRole.DEVELOPER) return;

  const raw = await getSettingValue('security.ipAllowlist');
  if (!raw) return;

  const entries = parseAllowlist(raw);
  if (entries.length === 0) return;

  const ip = req.ip;
  if (ip && isIpAllowed(ip, entries)) return;

  req.log.warn({
    event: 'authz.ip.denied',
    role: user.role,
    ip: ip ?? null,
    path: req.path,
  });

  auditDenied(req, {
    action: 'authz.ip.denied',
    entity: 'authz',
    changes: { role: user.role, ip: ip ?? null, path: req.path },
  });

  throw AppError.forbidden('Access from this network is not allowed');
}

/**
 * Throws on a WRITE from a user whose role is listed in
 * `security.require2faForRoles` but who has not enabled 2FA.
 *
 * ─── SAFETY RAIL: BLOCKS WRITES, NEVER LOGIN OR READS ─────────────────
 * The scope decision going in was explicit: this must never be a hard
 * lockout. A role added to the policy list mid-session cannot retroactively
 * strand someone outside the app entirely — they can still sign in, read
 * everything their role can already reach, and (critically) still reach
 * `POST /auth/me/2fa/setup` and `.../confirm` to comply, since those are
 * writes too and would otherwise be unreachable exactly when they're
 * needed. `TWO_FACTOR_SETUP_PATHS` is one exemption; `PATCH /settings`
 * itself is the other, for the same reason — otherwise an OWNER who lists
 * themselves (see the no-bypass note below) would be blocked from the one
 * write that could remove them from the list again. Deliberately only
 * `PATCH`, not the whole settings router: `POST /settings/*`-shaped writes
 * do not exist today, and exempting the general prefix rather than the
 * specific route would silently widen the exemption to anything added
 * there later without a fresh decision.
 *
 * ─── DELIBERATELY NO OWNER/DEVELOPER BYPASS ───────────────────────────
 * Unlike `assertNotInMaintenance` and `assertIpAllowed`, this does NOT
 * exempt OWNER/DEVELOPER. Those two exemptions exist because a WRONG
 * config (a bad CIDR, maintenance mode left on) can permanently lock out
 * the only people able to fix it — an unrecoverable failure mode. 2FA
 * policy has no such trap: any OWNER can edit `security.require2faForRoles`
 * at any time (reading and editing settings is unaffected by this check —
 * only OTHER writes are), or another OWNER/DEVELOPER can remove them from
 * the list. If an OWNER explicitly lists `OWNER`, that is a deliberate
 * choice to hold themselves to the same policy, and a blanket bypass here
 * would silently defeat exactly that.
 */
const TWO_FACTOR_EXEMPT_PATHS = new Set([
  '/auth/me/2fa/setup',
  '/auth/me/2fa/confirm',
  '/auth/me/2fa/disable',
  '/settings',
]);

export async function assertTwoFactorCompliant(req: Request): Promise<void> {
  const user = req.user;

  if (!user) return;
  if (READ_METHODS.has(req.method)) return;
  if (user.twoFactorEnabled) return;
  if (TWO_FACTOR_EXEMPT_PATHS.has(req.path)) return;

  const raw: string = await getSettingValue('security.require2faForRoles');
  if (!raw) return;

  const requiredRoles = new Set(
    raw
      .split(',')
      .map((role) => role.trim().toUpperCase())
      .filter((role) => role.length > 0),
  );
  if (!requiredRoles.has(user.role)) return;

  req.log.warn({
    event: 'authz.write.blocked.2fa_required',
    role: user.role,
    method: req.method,
    path: req.path,
  });

  auditDenied(req, {
    action: 'authz.write.blocked.2fa_required',
    entity: 'authz',
    changes: { role: user.role, method: req.method, path: req.path },
  });

  throw AppError.forbidden(
    'Your role requires two-factor authentication. Set it up in Settings to continue making changes.',
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

        auditDenied(req, {
          action: 'authz.area.denied',
          entity: 'authz',
          entityId: area,
          changes: { role: user.role, area, method: req.method, path: req.path },
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

        auditDenied(req, {
          action: 'authz.role.denied',
          entity: 'authz',
          changes: { role: user.role, required: roles, path: req.path },
        });

        throw AppError.forbidden('You do not have access to this resource');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
