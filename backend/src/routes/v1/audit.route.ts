import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { listAudit } from '../../services/audit.service.js';

/**
 * The audit trail.
 *
 * ─── READ ONLY, AND NOT BY ACCIDENT ──────────────────────────────────
 * There is no POST, PATCH or DELETE here, and there will not be. A trail that
 * can be edited is not evidence — the first thing anyone covering their tracks
 * would reach for is the record of what they did.
 *
 * Entries are written by the services themselves, never by a request.
 *
 * Gated on `staff`, not `reports`: it names people and what they did, which is
 * closer to personnel data than to business metrics. DEMO cannot reach `staff`
 * at all, so a demo account cannot read who works here or what they changed.
 */

export const auditRouter = Router();

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  entity: z.string().trim().max(48).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: z.string().trim().max(64).optional(),
});

auditRouter.get('/audit', authenticate, requireArea('staff'), async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  res.json({ data: await listAudit(parsed.data) });
});
