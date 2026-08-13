import { Router } from 'express';
import { StaffRole } from '@prisma/client';

import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { audit } from '../../services/audit.service.js';
import { deleteDemoData, previewDemoData } from '../../services/demo-data.service.js';

/**
 * Danger zone → "Delete test data" (B3.4).
 *
 * `requireRole` rather than `requireArea('settings')`: this is a genuinely
 * role-specific surface (irreversibly deleting rows), not an area a broader
 * grant should widen into automatically the way a future `settings` area
 * addition otherwise would.
 */
export const demoDataRouter = Router();

const guard = [authenticate, requireRole(StaffRole.OWNER, StaffRole.DEVELOPER)] as const;

demoDataRouter.get('/danger-zone/demo-data', ...guard, async (_req, res) => {
  res.json({ data: await previewDemoData() });
});

demoDataRouter.delete('/danger-zone/demo-data', ...guard, async (req, res) => {
  const actor = requireUser(req);
  const summary = await deleteDemoData();

  req.log.warn({ event: 'demo-data.deleted', userId: actor.id, ...summary });
  audit(req, {
    action: 'demo-data.deleted',
    entity: 'demo-data',
    changes: { rowCount: { from: summary.total, to: 0 } },
  });

  res.json({ data: summary });
});
