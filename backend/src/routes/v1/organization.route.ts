import { Router } from 'express';
import { StaffRole } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';
import { AppError } from '../../errors/AppError.js';
import { audit } from '../../services/audit.service.js';
import {
  createOrganizationField, entityTypeSchema, fieldBodySchema, fieldUpdateSchema,
  getOrganization, getOrganizationProfile, profileBodySchema, saveOrganizationProfile, updateOrganizationField,
} from '../../services/organization.service.js';

export const organizationRouter = Router();
const guard = [authenticate, requireRole(StaffRole.OWNER, StaffRole.DEVELOPER)] as const;
const profileParams = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1).max(64) });

organizationRouter.get('/organization', ...guard, async (_req, res) => {
  res.json({ data: await getOrganization() });
});

organizationRouter.post('/organization/fields', ...guard, async (req, res) => {
  const parsed = fieldBodySchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid custom field', parsed.error.flatten());
  const field = await createOrganizationField(parsed.data);
  audit(req, { action: 'organization.field.created', entity: 'organizationField', entityId: field.id });
  res.status(201).json({ data: field });
});

organizationRouter.patch('/organization/fields/:id', ...guard, async (req, res) => {
  const id = z.string().min(1).max(64).safeParse(req.params.id);
  const parsed = fieldUpdateSchema.safeParse(req.body);
  if (!id.success || !parsed.success) throw AppError.badRequest('Invalid custom field update');
  const field = await updateOrganizationField(id.data, parsed.data);
  audit(req, { action: 'organization.field.updated', entity: 'organizationField', entityId: field.id });
  res.json({ data: field });
});

organizationRouter.get('/organization/profiles/:entityType/:entityId', ...guard, async (req, res) => {
  const parsed = profileParams.safeParse(req.params);
  if (!parsed.success) throw AppError.badRequest('Invalid profile');
  res.json({ data: await getOrganizationProfile(parsed.data.entityType, parsed.data.entityId) });
});

organizationRouter.put('/organization/profiles/:entityType/:entityId', ...guard, async (req, res) => {
  const params = profileParams.safeParse(req.params);
  const parsed = profileBodySchema.safeParse(req.body);
  if (!params.success || !parsed.success) throw AppError.badRequest('Invalid profile', parsed.success ? undefined : parsed.error.flatten());
  const profile = await saveOrganizationProfile(params.data.entityType, params.data.entityId, parsed.data);
  audit(req, { action: 'organization.profile.updated', entity: params.data.entityType, entityId: params.data.entityId });
  res.json({ data: profile });
});
