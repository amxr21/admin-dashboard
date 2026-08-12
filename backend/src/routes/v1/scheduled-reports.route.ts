import { Router } from 'express';
import { ScheduleFormat, ScheduleFrequency } from '@prisma/client';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  createScheduledReport,
  deleteScheduledReport,
  listScheduledReports,
  runScheduledReport,
  updateScheduledReport,
} from '../../services/scheduled-reports.service.js';

/**
 * Scheduled reports (C3.2) — CRUD plus a manual "send now" for testing a
 * schedule without waiting for its next real tick. Gated on `reports`, same
 * area as every other report endpoint.
 */
export const scheduledReportsRouter = Router();

const guard = [authenticate, requireArea('reports')] as const;

const scheduleBody = z
  .object({
    reportKey: z.string().min(1).max(64),
    frequency: z.nativeEnum(ScheduleFrequency),
    format: z.nativeEnum(ScheduleFormat).optional(),
    recipients: z.array(z.string().trim().min(1)).min(1).max(20),
    isActive: z.boolean().optional(),
  })
  .strict();

const scheduleUpdateBody = scheduleBody.partial().strict();

scheduledReportsRouter.get('/scheduled-reports', ...guard, async (_req, res) => {
  res.json({ data: await listScheduledReports() });
});

scheduledReportsRouter.post('/scheduled-reports', ...guard, async (req, res) => {
  const parsed = scheduleBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  res.status(201).json({ data: await createScheduledReport(parsed.data, actor.id, req) });
});

scheduledReportsRouter.patch('/scheduled-reports/:id', ...guard, async (req, res) => {
  const parsed = scheduleUpdateBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());
  if (Object.keys(parsed.data).length === 0) {
    throw AppError.badRequest('Provide at least one field to update');
  }

  res.json({ data: await updateScheduledReport(String(req.params.id), parsed.data, req) });
});

scheduledReportsRouter.delete('/scheduled-reports/:id', ...guard, async (req, res) => {
  await deleteScheduledReport(String(req.params.id), req);
  res.status(204).send();
});

/**
 * POST, not GET: this sends real email — a retried/prefetched GET must
 * never trigger a send.
 */
scheduledReportsRouter.post('/scheduled-reports/:id/send-now', ...guard, async (req, res) => {
  const outcome = await runScheduledReport(String(req.params.id));
  res.json({ data: outcome });
});
