import { Router, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { toCsv, type CsvColumn } from '../../lib/csv.js';
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
  // Same data as the JSON response, shaped as rows — a spreadsheet a manager
  // can open directly rather than a blob they have to ask engineering to
  // parse. Never a different QUERY, only a different rendering of one.
  format: z.enum(['json', 'csv']).optional(),
});

/** Sends one CSV file and nothing else — callers return right after. */
function sendCsv<T>(res: Response, filename: string, rows: readonly T[], columns: readonly CsvColumn<T>[]): void {
  res
    .status(200)
    .type('text/csv')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .send(toCsv(rows, columns));
}

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

  const overview = await getOverview(parsed.data);

  if (parsed.data.format === 'csv') {
    sendCsv(res, 'overview.csv', [overview], [
      { header: 'From', value: (r) => r.range.from },
      { header: 'To', value: (r) => r.range.to },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Canceled orders', value: (r) => r.canceledOrders },
      { header: 'New customers', value: (r) => r.newCustomers },
      { header: 'Low stock products', value: (r) => r.lowStockProducts },
      { header: 'Average order value', value: (r) => r.averageOrderValue },
    ]);
    return;
  }

  res.json({ data: overview });
});

reportsRouter.get('/reports/revenue', ...guard, async (req, res) => {
  const parsed = seriesQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const series = await getRevenueSeries(parsed.data);

  if (parsed.data.format === 'csv') {
    sendCsv(res, 'revenue.csv', series.points, [
      { header: 'Date', value: (r) => r.date },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
    ]);
    return;
  }

  res.json({ data: series });
});

reportsRouter.get('/reports/top-products', ...guard, async (req, res) => {
  const parsed = topQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const top = await getTopProducts(parsed.data);

  if (parsed.data.format === 'csv') {
    sendCsv(res, 'top-products.csv', top.products, [
      { header: 'Product ID', value: (r) => r.productId ?? '' },
      // Falls back rather than leaving the cell blank with no explanation —
      // matches the JSON response's own honesty about a hard-deleted product.
      { header: 'Name', value: (r) => r.name ?? '(deleted product)' },
      { header: 'Quantity', value: (r) => r.quantity },
      { header: 'Revenue', value: (r) => r.revenue },
    ]);
    return;
  }

  res.json({ data: top });
});

reportsRouter.get('/reports/status-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const breakdown = await getStatusBreakdown(parsed.data);

  if (parsed.data.format === 'csv') {
    sendCsv(res, 'status-breakdown.csv', breakdown.statuses, [
      { header: 'Status', value: (r) => r.status },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Total', value: (r) => r.total },
    ]);
    return;
  }

  res.json({ data: breakdown });
});
