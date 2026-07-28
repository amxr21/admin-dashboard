import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  getOverview,
  getRevenueSeries,
  getStatusBreakdown,
  getTopProducts,
} from '../../services/reports.service.js';

/**
 * Reporting.
 *
 * Read-only, so there is no write path to guard — but `requireArea('reports')`
 * still applies, because revenue is not something every role should see. A
 * FULFILLMENT account picking orders has no business reading turnover.
 *
 * Named routes rather than the engine: every response is a GROUP BY over a
 * date range, and there is no field list that could express that.
 */

export const reportsRouter = Router();

const guard = [authenticate, requireArea('reports')] as const;

/** Date-only, so a caller cannot smuggle a timezone in and shift the range. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const rangeQuery = z.object({
  from: isoDate,
  to: isoDate,
});

const seriesQuery = rangeQuery.extend({
  // An allowlist at the boundary AND a map inside the service. The enum is
  // what makes the service's lookup total; the map is what keeps the value out
  // of the SQL string.
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

const topQuery = rangeQuery.extend({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

reportsRouter.get('/reports/overview', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  res.json({ data: await getOverview(parsed.data) });
});

reportsRouter.get('/reports/revenue', ...guard, async (req, res) => {
  const parsed = seriesQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  res.json({ data: await getRevenueSeries(parsed.data) });
});

reportsRouter.get('/reports/top-products', ...guard, async (req, res) => {
  const parsed = topQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  res.json({ data: await getTopProducts(parsed.data) });
});

reportsRouter.get('/reports/status-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  res.json({ data: await getStatusBreakdown(parsed.data) });
});
