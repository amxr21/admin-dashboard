import { Router } from 'express';
import { StaffRole } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireDeveloperVisible, requireRole } from '../../middleware/authorize.js';
import { AppError } from '../../errors/AppError.js';
import { setupDraftSchema } from '../../config/setup.config.js';
import { applySetup, previewSetup, readSetup, skipSetup } from '../../services/setup.service.js';
import { audit } from '../../services/audit.service.js';

export const setupRouter = Router();
setupRouter.use('/setup', authenticate, requireRole(StaffRole.OWNER, StaffRole.DEVELOPER), requireDeveloperVisible('settings'));
setupRouter.get('/setup', async (_req, res) => { res.json({ data: await readSetup() }); });

function parseDraft(body: unknown) {
  const parsed = setupDraftSchema.safeParse(body);
  if (!parsed.success) throw AppError.badRequest('Invalid setup', parsed.error.flatten());
  return parsed.data;
}
setupRouter.post('/setup/preview', async (req, res) => {
  res.json({ data: await previewSetup(parseDraft(req.body)) });
});
setupRouter.put('/setup', async (req, res) => {
  const data = await applySetup(parseDraft(req.body), requireUser(req).id);
  audit(req, { action: 'setup.applied', entity: 'setup', changes: {
    businessType: data.normalized.businessType, enabledFeatures: data.enabledFeatures,
    disabledFeatures: data.disabledFeatures, permissionChanges: data.permissionChanges,
    labelChanges: data.labelChanges, settingChanges: data.settingChanges,
  } });
  res.json({ data });
});
setupRouter.post('/setup/skip', async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body ?? {}).success) throw AppError.badRequest('Expected an empty request');
  const data = await skipSetup();
  audit(req, { action: 'setup.skipped', entity: 'setup' });
  res.json({ data });
});
