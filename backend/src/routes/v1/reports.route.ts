import { Router, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { toCsv, type CsvColumn } from '../../lib/csv.js';
import { toXlsx } from '../../lib/xlsx.js';
import { toPdf } from '../../lib/pdf.js';
import {
  getAuditActivityByEntity,
  getAuditOutcomeTrend,
  getCategoryBreakdown,
  getCourierPerformance,
  getCourierWorkloadSnapshot,
  getCustomerGeography,
  getCustomerLifetimeValue,
  getCustomerNewVsReturning,
  getCustomerOrderFrequency,
  getDeliveryCycleTime,
  getDeliveryZoneBreakdown,
  getExplorerRows,
  getFulfillmentHealth,
  getGuestVsRegistered,
  getInventoryTurnover,
  getLowStockSnapshot,
  getNeedsAttention,
  getOrderValueDistribution,
  getOverview,
  getPaymentMethodBreakdown,
  getProductMargin,
  getProductReviewSummary,
  getProductsWithoutReviews,
  getRefundRateTrend,
  getReturnReasons,
  getReturnResolutionBreakdown,
  getReturnsSummary,
  getReviewModerationThroughput,
  getRevenueSeries,
  getStaffActivity,
  getStatusBreakdown,
  getStockAdjustmentReasons,
  getTopProducts,
  getVariantStockMovement,
  isExplorerDimension,
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
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).optional(),
});

type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * Sends one export file and nothing else — callers return right after.
 * All three formats read the SAME `columns` definition (`CsvColumn<T>`,
 * despite the name — it's really "one column, three renderers"), so a
 * report's CSV/XLSX/PDF are guaranteed to list the same fields in the same
 * order rather than three hand-maintained lists that could drift apart.
 */
async function sendExport<T>(
  res: Response,
  format: ExportFormat,
  title: string,
  baseFilename: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): Promise<void> {
  if (format === 'csv') {
    res
      .status(200)
      .type('text/csv')
      .set('Content-Disposition', `attachment; filename="${baseFilename}.csv"`)
      .send(toCsv(rows, columns));
    return;
  }

  if (format === 'xlsx') {
    const buffer = await toXlsx(title, rows, columns);
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', `attachment; filename="${baseFilename}.xlsx"`)
      .send(buffer);
    return;
  }

  const buffer = await toPdf(title, rows, columns);
  res
    .status(200)
    .type('application/pdf')
    .set('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`)
    .send(buffer);
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

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Revenue overview', 'overview', [overview], [
      { header: 'From', value: (r) => r.range.from },
      { header: 'To', value: (r) => r.range.to },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Canceled orders', value: (r) => r.canceledOrders },
      { header: 'New customers', value: (r) => r.newCustomers },
      { header: 'Low stock products', value: (r) => r.lowStockProducts },
      { header: 'Units sold', value: (r) => r.unitsSold },
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

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Revenue over time', 'revenue', series.points, [
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

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Best sellers', 'top-products', top.products, [
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

reportsRouter.get('/reports/fulfillment-health', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const health = await getFulfillmentHealth(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Fulfillment health', 'fulfillment-health', health.needsAttention, [
      { header: 'Order', value: (r) => r.orderNumber },
      { header: 'Status', value: (r) => r.status },
      { header: 'Hours in status', value: (r) => r.hoursInStatus },
    ]);
    return;
  }

  res.json({ data: health });
});

reportsRouter.get('/reports/returns-summary', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const summary = await getReturnsSummary(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Returns summary', 'returns-summary', summary.topReturnedProducts, [
      { header: 'Product ID', value: (r) => r.productId ?? '' },
      { header: 'Name', value: (r) => r.name ?? '(deleted product)' },
      { header: 'Units returned', value: (r) => r.unitsReturned },
      { header: 'Returns', value: (r) => r.returnCount },
    ]);
    return;
  }

  res.json({ data: summary });
});

reportsRouter.get('/reports/order-value-distribution', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const distribution = await getOrderValueDistribution(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(
      res,
      parsed.data.format,
      'Order value distribution',
      'order-value-distribution',
      distribution.buckets,
      [
        { header: 'Range', value: (r) => r.label },
        { header: 'Orders', value: (r) => r.count },
      ],
    );
    return;
  }

  res.json({ data: distribution });
});

reportsRouter.get('/reports/status-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const breakdown = await getStatusBreakdown(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Order outcomes', 'status-breakdown', breakdown.statuses, [
      { header: 'Status', value: (r) => r.status },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Total', value: (r) => r.total },
    ]);
    return;
  }

  res.json({ data: breakdown });
});

/**
 * C1.5 — the cross-cutting "needs attention" queue. No date-range params:
 * see `getNeedsAttention`'s own doc comment for why this is deliberately
 * live state rather than scoped to the dashboard's selected window. No CSV
 * either — this is an action queue meant to be cleared, not a report meant
 * to be archived.
 */
reportsRouter.get('/reports/needs-attention', ...guard, async (_req, res) => {
  res.json({ data: await getNeedsAttention() });
});

// ─── C3.5 — new domain reports, same range/CSV shape as everything above ──

reportsRouter.get('/reports/staff-activity', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const activity = await getStaffActivity(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Staff activity', 'staff-activity', activity.staff, [
      { header: 'Actor email', value: (r) => r.actorEmail },
      { header: 'Role', value: (r) => r.actorRole ?? '' },
      { header: 'Actions', value: (r) => r.actionCount },
      { header: 'Denied attempts', value: (r) => r.deniedCount },
    ]);
    return;
  }

  res.json({ data: activity });
});

reportsRouter.get('/reports/category-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const breakdown = await getCategoryBreakdown(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Revenue by category', 'category-breakdown', breakdown.categories, [
      { header: 'Category', value: (r) => r.categoryName },
      { header: 'Units', value: (r) => r.units },
      { header: 'Revenue', value: (r) => r.revenue },
    ]);
    return;
  }

  res.json({ data: breakdown });
});

reportsRouter.get('/reports/refund-rate-trend', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const trend = await getRefundRateTrend(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Refund rate trend', 'refund-rate-trend', trend.points, [
      { header: 'Month', value: (r) => r.date },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Refunded', value: (r) => r.refunded },
      { header: 'Refund rate', value: (r) => (r.refundRate * 100).toFixed(2) + '%' },
    ]);
    return;
  }

  res.json({ data: trend });
});

/**
 * The generic report viewer's data source (C3.3) — same range/CSV shape as
 * every report above, plus a `dimension` picker the frontend renders as the
 * group-by selector. `isExplorerDimension` is the same allowlist-at-the-
 * boundary discipline as `granularity` on `/reports/revenue`: the request
 * chooses a key, the service map supplies the SQL fragment, never the
 * reverse.
 */
const explorerQuery = rangeQuery.extend({
  dimension: z.string().refine(isExplorerDimension, 'Unknown dimension'),
});

reportsRouter.get('/reports/explorer', ...guard, async (req, res) => {
  const parsed = explorerQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const explorer = await getExplorerRows(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Report explorer', 'explorer', explorer.rows, [
      { header: 'Label', value: (r) => r.label },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Units', value: (r) => r.units },
      { header: 'Orders', value: (r) => r.orders },
      { header: 'Average order value', value: (r) => r.averageOrderValue },
    ]);
    return;
  }

  res.json({ data: explorer });
});

reportsRouter.get('/reports/inventory-turnover', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const turnover = await getInventoryTurnover(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Inventory turnover', 'inventory-turnover', turnover.turnover, [
      { header: 'Product', value: (r) => r.name },
      { header: 'SKU', value: (r) => r.sku ?? '' },
      { header: 'Current stock', value: (r) => r.stock },
      { header: 'Units sold', value: (r) => r.unitsSold },
    ]);
    return;
  }

  res.json({ data: turnover });
});

// ─── C3.5 (second batch) — customer domain ────────────────────────────────

reportsRouter.get('/reports/customer-geography', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const geography = await getCustomerGeography(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Customer geography', 'customer-geography', geography.rows, [
      { header: 'City', value: (r) => r.city },
      { header: 'Country', value: (r) => r.country },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
    ]);
    return;
  }

  res.json({ data: geography });
});

reportsRouter.get('/reports/customer-new-vs-returning', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const split = await getCustomerNewVsReturning(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(
      res,
      parsed.data.format,
      'New vs. returning customers',
      'customer-new-vs-returning',
      [split],
      [
        { header: 'New — revenue', value: (r) => r.new.revenue },
        { header: 'New — orders', value: (r) => r.new.orders },
        { header: 'Returning — revenue', value: (r) => r.returning.revenue },
        { header: 'Returning — orders', value: (r) => r.returning.orders },
      ],
    );
    return;
  }

  res.json({ data: split });
});

const ltvQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).optional(),
});

reportsRouter.get('/reports/customer-lifetime-value', ...guard, async (req, res) => {
  const parsed = ltvQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid parameters', parsed.error.flatten());

  const ltv = await getCustomerLifetimeValue(parsed.data.limit);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(
      res,
      parsed.data.format,
      'Customer lifetime value',
      'customer-lifetime-value',
      ltv.customers,
      [
        { header: 'Customer', value: (r) => r.name },
        { header: 'Email', value: (r) => r.email },
        { header: 'Revenue', value: (r) => r.revenue },
        { header: 'Orders', value: (r) => r.orders },
        { header: 'Average order value', value: (r) => r.averageOrderValue },
      ],
    );
    return;
  }

  res.json({ data: ltv });
});

reportsRouter.get('/reports/customer-order-frequency', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const frequency = await getCustomerOrderFrequency(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(
      res,
      parsed.data.format,
      'Customer order frequency',
      'customer-order-frequency',
      frequency.buckets,
      [
        { header: 'Orders placed', value: (r) => r.label },
        { header: 'Customers', value: (r) => r.customers },
      ],
    );
    return;
  }

  res.json({ data: frequency });
});

reportsRouter.get('/reports/guest-vs-registered', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const split = await getGuestVsRegistered(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Guest vs. registered orders', 'guest-vs-registered', [split], [
      { header: 'Guest — revenue', value: (r) => r.guest.revenue },
      { header: 'Guest — orders', value: (r) => r.guest.orders },
      { header: 'Registered — revenue', value: (r) => r.registered.revenue },
      { header: 'Registered — orders', value: (r) => r.registered.orders },
    ]);
    return;
  }

  res.json({ data: split });
});

reportsRouter.get('/reports/payment-method-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const breakdown = await getPaymentMethodBreakdown(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Payment method breakdown', 'payment-method-breakdown', breakdown.methods, [
      { header: 'Payment method', value: (r) => r.paymentMethod },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'Orders', value: (r) => r.orders },
    ]);
    return;
  }

  res.json({ data: breakdown });
});

reportsRouter.get('/reports/product-margin', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const margin = await getProductMargin(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Product margin', 'product-margin', margin.products, [
      { header: 'Product', value: (r) => r.name },
      { header: 'SKU', value: (r) => r.sku ?? '' },
      { header: 'Revenue', value: (r) => r.revenue },
      { header: 'COGS', value: (r) => r.cogs },
      { header: 'Margin', value: (r) => r.margin },
      { header: 'Margin %', value: (r) => (r.marginPercent * 100).toFixed(2) + '%' },
      { header: 'Units', value: (r) => r.units },
    ]);
    return;
  }

  res.json({ data: margin });
});

reportsRouter.get('/reports/product-review-summary', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const summary = await getProductReviewSummary(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Product review summary', 'product-review-summary', summary.products, [
      { header: 'Product', value: (r) => r.name },
      { header: 'Reviews', value: (r) => r.reviewCount },
      { header: 'Average rating', value: (r) => r.averageRating.toFixed(2) },
      { header: '1 star', value: (r) => r.distribution[1] },
      { header: '2 star', value: (r) => r.distribution[2] },
      { header: '3 star', value: (r) => r.distribution[3] },
      { header: '4 star', value: (r) => r.distribution[4] },
      { header: '5 star', value: (r) => r.distribution[5] },
    ]);
    return;
  }

  res.json({ data: summary });
});

reportsRouter.get('/reports/review-moderation-throughput', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const throughput = await getReviewModerationThroughput(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(
      res,
      parsed.data.format,
      'Review moderation throughput',
      'review-moderation-throughput',
      [throughput],
      [
        { header: 'Submitted', value: (r) => r.submitted },
        { header: 'Approved', value: (r) => r.approved },
        { header: 'Rejected', value: (r) => r.rejected },
        { header: 'Pending', value: (r) => r.pending },
        { header: 'Avg. hours to moderation', value: (r) => r.averageHoursToModeration?.toFixed(1) ?? '' },
      ],
    );
    return;
  }

  res.json({ data: throughput });
});

/**
 * Products with no reviews (C3.5) — live catalogue state, not date-range
 * scoped ("has this product ever been reviewed" doesn't reset every
 * period), same as `/reports/needs-attention`.
 */
reportsRouter.get('/reports/products-without-reviews', ...guard, async (_req, res) => {
  res.json({ data: await getProductsWithoutReviews() });
});

// ─── C3.5 (second batch) — inventory domain ────────────────────────────────

/**
 * Low-stock / stockout snapshot (C3.5) — live catalogue state, not date-
 * range scoped, same as `/reports/needs-attention`.
 */
reportsRouter.get('/reports/low-stock-snapshot', ...guard, async (req, res) => {
  const formatParsed = z.object({ format: z.enum(['json', 'csv', 'xlsx', 'pdf']).optional() }).safeParse(req.query);
  if (!formatParsed.success) throw AppError.badRequest('Invalid parameters', formatParsed.error.flatten());

  const snapshot = await getLowStockSnapshot();

  if (formatParsed.data.format && formatParsed.data.format !== 'json') {
    await sendExport(res, formatParsed.data.format, 'Low stock snapshot', 'low-stock-snapshot', snapshot.products, [
      { header: 'Product', value: (r) => r.name },
      { header: 'SKU', value: (r) => r.sku ?? '' },
      { header: 'Stock', value: (r) => r.stock },
      { header: 'Days since last restock', value: (r) => r.daysSinceLastRestock ?? '' },
    ]);
    return;
  }

  res.json({ data: snapshot });
});

reportsRouter.get('/reports/stock-adjustment-reasons', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const reasons = await getStockAdjustmentReasons(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Stock adjustment reasons', 'stock-adjustment-reasons', reasons.reasons, [
      { header: 'Reason', value: (r) => r.reason },
      { header: 'Movements', value: (r) => r.movements },
      { header: 'Net units', value: (r) => r.netUnits },
    ]);
    return;
  }

  res.json({ data: reasons });
});

reportsRouter.get('/reports/variant-stock-movement', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const movement = await getVariantStockMovement(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Variant stock movement', 'variant-stock-movement', movement.variants, [
      { header: 'Product', value: (r) => r.productName },
      { header: 'Variant', value: (r) => r.name },
      { header: 'SKU', value: (r) => r.sku ?? '' },
      { header: 'Current stock', value: (r) => r.stock },
      { header: 'Units sold', value: (r) => r.sold },
      { header: 'Units received', value: (r) => r.received },
    ]);
    return;
  }

  res.json({ data: movement });
});

// ─── C3.5 (second batch) — returns domain ─────────────────────────────────

reportsRouter.get('/reports/return-resolution-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const breakdown = await getReturnResolutionBreakdown(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(
      res,
      parsed.data.format,
      'Return resolution breakdown',
      'return-resolution-breakdown',
      breakdown.byResolution,
      [
        { header: 'Resolution', value: (r) => r.resolution },
        { header: 'Count', value: (r) => r.count },
        { header: 'Refunded value', value: (r) => r.refundedValue },
      ],
    );
    return;
  }

  res.json({ data: breakdown });
});

reportsRouter.get('/reports/return-reasons', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const reasons = await getReturnReasons(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Return reasons', 'return-reasons', reasons.returns, [
      { header: 'RMA', value: (r) => r.rmaNumber },
      { header: 'Status', value: (r) => r.status },
      { header: 'Reason', value: (r) => r.reason },
      { header: 'Requested at', value: (r) => r.createdAt },
    ]);
    return;
  }

  res.json({ data: reasons });
});

// ─── C3.5 (second batch) — delivery domain ─────────────────────────────────

reportsRouter.get('/reports/courier-performance', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const performance = await getCourierPerformance(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Courier performance', 'courier-performance', performance.couriers, [
      { header: 'Courier', value: (r) => r.name },
      { header: 'Total assignments', value: (r) => r.total },
      { header: 'Delivered', value: (r) => r.byStatus['DELIVERED'] ?? 0 },
      { header: 'Out for delivery', value: (r) => r.byStatus['OUT_FOR_DELIVERY'] ?? 0 },
      { header: 'Canceled', value: (r) => r.byStatus['CANCELED'] ?? 0 },
      { header: 'Returned', value: (r) => r.byStatus['RETURNED'] ?? 0 },
    ]);
    return;
  }

  res.json({ data: performance });
});

reportsRouter.get('/reports/delivery-zone-breakdown', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const zones = await getDeliveryZoneBreakdown(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Delivery zone breakdown', 'delivery-zone-breakdown', zones.zones, [
      { header: 'Zone', value: (r) => r.zone },
      { header: 'Region', value: (r) => r.region },
      { header: 'Assignments', value: (r) => r.assignments },
      { header: 'Collectible value', value: (r) => r.collectibleValue },
    ]);
    return;
  }

  res.json({ data: zones });
});

reportsRouter.get('/reports/delivery-cycle-time', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const cycleTime = await getDeliveryCycleTime(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Delivery cycle time', 'delivery-cycle-time', [cycleTime], [
      { header: 'Delivered count', value: (r) => r.deliveredCount },
      { header: 'Average hours', value: (r) => r.averageHours?.toFixed(1) ?? '' },
      { header: 'Median hours', value: (r) => r.medianHours ?? '' },
    ]);
    return;
  }

  res.json({ data: cycleTime });
});

/**
 * Courier workload / active-roster snapshot (C3.5) — live state, not date-
 * range scoped, same as `/reports/needs-attention`.
 */
reportsRouter.get('/reports/courier-workload-snapshot', ...guard, async (_req, res) => {
  res.json({ data: await getCourierWorkloadSnapshot() });
});

// ─── C3.5 (second batch) — audit/security domain ───────────────────────────

reportsRouter.get('/reports/audit-outcome-trend', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const trend = await getAuditOutcomeTrend(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Audit outcome trend', 'audit-outcome-trend', trend.points, [
      { header: 'Date', value: (r) => r.date },
      { header: 'Success', value: (r) => r.success },
      { header: 'Denied', value: (r) => r.denied },
      { header: 'Error', value: (r) => r.error },
    ]);
    return;
  }

  res.json({ data: trend });
});

reportsRouter.get('/reports/audit-activity-by-entity', ...guard, async (req, res) => {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid range', parsed.error.flatten());

  const activity = await getAuditActivityByEntity(parsed.data);

  if (parsed.data.format && parsed.data.format !== 'json') {
    await sendExport(res, parsed.data.format, 'Audit activity by entity', 'audit-activity-by-entity', activity.rows, [
      { header: 'Entity', value: (r) => r.entity },
      { header: 'Action', value: (r) => r.action },
      { header: 'Count', value: (r) => r.count },
    ]);
    return;
  }

  res.json({ data: activity });
});
