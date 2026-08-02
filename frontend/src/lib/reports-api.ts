import { apiDownload, apiFetch } from '@/lib/api';

/**
 * Client for `/api/v1/reports`.
 *
 * ─── MONEY IS A STRING HERE TOO ──────────────────────────────────────
 * Every amount arrives as `"350.00"` and is formatted for display, never
 * parsed into app state. The one permitted `Number()` is inside a chart, where
 * a pixel height genuinely needs a number and the rounding cannot reach the
 * database.
 */

export type Granularity = 'day' | 'week' | 'month';

export const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

/** Matches MAX_RANGE_DAYS in the backend service. */
export const MAX_RANGE_DAYS = 731;

export interface DateRange {
  from: string;
  to: string;
}

export interface Overview {
  range: DateRange;
  revenue: string;
  orders: number;
  canceledOrders: number;
  newCustomers: number;
  lowStockProducts: number;
  averageOrderValue: string;
}

export interface RevenueSeries {
  range: DateRange;
  granularity: Granularity;
  points: { date: string; revenue: string; orders: number }[];
}

export interface TopProducts {
  range: DateRange;
  products: {
    productId: string | null;
    /** Null when the product was hard-deleted — line items keep no name. */
    name: string | null;
    quantity: number;
    revenue: string;
  }[];
}

export interface StatusBreakdown {
  range: DateRange;
  statuses: { status: string; orders: number; total: string }[];
}

export interface FulfillmentHealth {
  range: DateRange;
  avgHoursInStatus: { status: string; slaHours: number; avgHours: number | null }[];
  needsAttention: { orderId: string; orderNumber: string; status: string; hoursInStatus: number }[];
}

export interface ReturnsSummary {
  range: DateRange;
  returnCount: number;
  orderCount: number;
  returnRate: number;
  refundValue: string;
  unitsReturned: number;
  topReturnedProducts: { productId: string | null; name: string | null; unitsReturned: number; returnCount: number }[];
}

export interface OrderValueDistribution {
  range: DateRange;
  buckets: { label: string; count: number }[];
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }

  return search.toString();
}

export async function fetchOverview(range: DateRange): Promise<Overview> {
  return apiFetch<Overview>(`/reports/overview?${query({ ...range })}`);
}

export async function fetchRevenue(
  range: DateRange,
  granularity: Granularity = 'day',
): Promise<RevenueSeries> {
  return apiFetch<RevenueSeries>(`/reports/revenue?${query({ ...range, granularity })}`);
}

export async function fetchTopProducts(
  range: DateRange,
  limit = 10,
): Promise<TopProducts> {
  return apiFetch<TopProducts>(`/reports/top-products?${query({ ...range, limit })}`);
}

export async function fetchStatusBreakdown(range: DateRange): Promise<StatusBreakdown> {
  return apiFetch<StatusBreakdown>(`/reports/status-breakdown?${query({ ...range })}`);
}

export async function fetchFulfillmentHealth(range: DateRange): Promise<FulfillmentHealth> {
  return apiFetch<FulfillmentHealth>(`/reports/fulfillment-health?${query({ ...range })}`);
}

export async function fetchReturnsSummary(range: DateRange): Promise<ReturnsSummary> {
  return apiFetch<ReturnsSummary>(`/reports/returns-summary?${query({ ...range })}`);
}

export async function fetchOrderValueDistribution(range: DateRange): Promise<OrderValueDistribution> {
  return apiFetch<OrderValueDistribution>(`/reports/order-value-distribution?${query({ ...range })}`);
}

export type ReportView = 'overview' | 'revenue' | 'top-products' | 'status-breakdown';

/** Same endpoint as the JSON fetch above, `format=csv` instead of the shape changing. */
export async function downloadReportCsv(
  view: ReportView,
  range: DateRange,
  extra: Record<string, string | number | undefined> = {},
): Promise<void> {
  const search = query({ ...range, ...extra, format: 'csv' });
  await apiDownload(`/reports/${view}?${search}`, `${view}.csv`);
}

/** Local Y/M/D — `toISOString` would shift the day west of Greenwich. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The default window: the last 30 days, ending today. */
export function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);

  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/**
 * The immediately preceding period of EQUAL LENGTH — what a "vs previous
 * period" comparison actually means. A 14-day range compares against the
 * 14 days before it, not against "last month," so the two figures describe
 * the same amount of business activity.
 */
export function previousPeriod(range: DateRange): DateRange {
  // Local-time arithmetic throughout, matching `defaultRange()` — mixing in
  // UTC-anchored dates here would disagree with `toIsoDate`'s local getters
  // and drift a day near midnight in some timezones.
  const [fromY, fromM, fromD] = range.from.split('-').map(Number);
  const [toY, toM, toD] = range.to.split('-').map(Number);
  const from = new Date(fromY!, fromM! - 1, fromD);
  const to = new Date(toY!, toM! - 1, toD);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));

  return { from: toIsoDate(prevFrom), to: toIsoDate(prevTo) };
}

/** Percentage change from `previous` to `current`, or `undefined` when the
 *  previous period was zero — a percentage of zero is undefined, not 0%. */
export function deltaPercent(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}
