import { Router } from 'express';
import { StaffRole } from '@prisma/client';

import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { AREAS, ROLE_LABELS, areasFor, isReadOnlyRole } from '../../config/roles.js';

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
rolesRouter.get('/roles', authenticate, (_req, res) => {
  const roles = Object.values(StaffRole).map((role) => ({
    role,
    label: ROLE_LABELS[role],
    areas: areasFor(role),
    readOnly: isReadOnlyRole(role),
  }));

  res.status(200).json({ data: { roles, areas: AREAS } });
});

// GET /api/v1/roles/me — what the CURRENT caller can do. Saves the frontend
// having to work it out from the role, and keeps the logic in one place.
rolesRouter.get('/roles/me', authenticate, (req, res) => {
  const user = requireUser(req);

  res.status(200).json({
    data: {
      role: user.role,
      label: ROLE_LABELS[user.role],
      areas: areasFor(user.role),
      readOnly: isReadOnlyRole(user.role),
    },
  });
});
