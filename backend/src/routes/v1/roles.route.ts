import { Router } from 'express';
import { StaffRole } from '@prisma/client';

import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { AREAS, ROLE_LABELS, isReadOnlyRole } from '../../config/roles.js';
import { audit } from '../../services/audit.service.js';
import {
  listRolePermissions,
  resetRoleAreas,
  resolveAreas,
  setRoleAreas,
} from '../../services/role-permissions.service.js';

/**
 * Exposes the permission model so the UI can mirror it — hiding controls a
 * role cannot use, rather than showing buttons that 403.
 *
 * This is a CONVENIENCE, not a control. The API enforces every rule
 * independently; a client that ignores this response gains nothing.
 */

export const rolesRouter = Router();

// GET /api/v1/roles — the full model. Any authenticated user may read it;
// knowing the permission structure grants nothing on its own.
rolesRouter.get('/roles', authenticate, async (_req, res) => {
  // Resolved, not the code default (O8): an owner can edit what a role
  // reaches, and a matrix showing the shipped defaults would disagree with
  // what the API actually enforces.
  const resolved = await listRolePermissions();

  const roles = resolved.map((entry) => ({
    role: entry.role,
    label: ROLE_LABELS[entry.role],
    areas: entry.areas,
    readOnly: isReadOnlyRole(entry.role),
    /** Owners and developers always keep full access — the matrix renders
     *  them read-only, and the API refuses them either way. */
    isLocked: entry.isLocked,
    /** Whether an owner has changed this from the shipped default, so "why
     *  can Support see reports" has a visible answer. */
    isCustomised: entry.isCustomised,
  }));

  res.status(200).json({ data: { roles, areas: AREAS } });
});

// GET /api/v1/roles/me — what the CURRENT caller can do. Saves the frontend
// having to work it out from the role, and keeps the logic in one place.
rolesRouter.get('/roles/me', authenticate, async (req, res) => {
  const user = requireUser(req);

  res.status(200).json({
    data: {
      role: user.role,
      // Resolved (O8). This drives what the sidebar shows, so reading the
      // code default here would leave a user looking at links the API now
      // refuses — or missing links it now allows.
      areas: await resolveAreas(user.role),
      label: ROLE_LABELS[user.role],
      readOnly: isReadOnlyRole(user.role),
    },
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * EDITING WHAT A ROLE MAY REACH (O8.3)
 *
 * OWNER/DEVELOPER only. Not `requireArea('settings')`: MANAGER holds that
 * area today, and a role that can widen its OWN permissions has no
 * permissions at all — it is one save away from anything.
 * ───────────────────────────────────────────────────────────────────── */

const areasBody = z.object({
  // The intended FINAL set, not a diff: the matrix edits checkboxes, and
  // applying a diff computed against a stale page removes an area nobody
  // touched. An empty array is a real choice — "this role reaches nothing".
  areas: z.array(z.string().trim().min(1)).max(64),
});

function parseRole(value: string): StaffRole {
  if (!(Object.values(StaffRole) as string[]).includes(value)) {
    throw AppError.notFound('No such role');
  }

  return value as StaffRole;
}

rolesRouter.put(
  '/roles/:role/areas',
  authenticate,
  requireRole(StaffRole.OWNER, StaffRole.DEVELOPER),
  async (req, res) => {
    const parsed = areasBody.safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid request', parsed.error.flatten());
    }

    const role = parseRole(String(req.params.role));
    const user = requireUser(req);

    const { before, after } = await setRoleAreas(role, parsed.data.areas, user.id);

    audit(req, {
      action: 'role.permissions_changed',
      entity: 'roles',
      entityId: role,
      changes: {
        // Both sides: "changed Manager's areas" is unanswerable without what
        // they were, and this is the audit entry somebody reads when asking
        // why a person lost a screen.
        areas: { from: before, to: after },
      },
    });

    res.status(200).json({ data: { role, areas: after } });
  },
);

/**
 * Drop the override, returning the role to its shipped default.
 *
 * A real action rather than "tick everything back by hand": the defaults
 * change between releases, and an owner who reset manually today would be
 * frozen at whatever this version happened to grant.
 */
rolesRouter.delete(
  '/roles/:role/areas',
  authenticate,
  requireRole(StaffRole.OWNER, StaffRole.DEVELOPER),
  async (req, res) => {
    const role = parseRole(String(req.params.role));

    const { before, after } = await resetRoleAreas(role);

    audit(req, {
      action: 'role.permissions_reset',
      entity: 'roles',
      entityId: role,
      changes: { areas: { from: before, to: after } },
    });

    res.status(200).json({ data: { role, areas: after } });
  },
);
