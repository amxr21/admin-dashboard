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

/**
 * The same calendar window one year earlier — for a "same period last year"
 * comparison, as opposed to `previousPeriod`'s immediately-preceding window.
 * Plain year subtraction on both ends (not day-count arithmetic): a
 * year-over-year comparison means "the same dates," not "the same number of
 * days before." `Date`'s own normalisation handles Feb 29 by rolling to
 * Mar 1 in a non-leap target year, which is the conventional behaviour.
 */
export function samePeriodLastYear(range: DateRange): DateRange {
  const [fromY, fromM, fromD] = range.from.split('-').map(Number);
  const [toY, toM, toD] = range.to.split('-').map(Number);

  return {
    from: toIsoDate(new Date(fromY! - 1, fromM! - 1, fromD)),
    to: toIsoDate(new Date(toY! - 1, toM! - 1, toD)),
  };
}

export type RangePreset = 'today' | '7d' | '30d' | 'mtd' | 'qtd' | 'custom';

/** Computes the concrete range for every preset except `custom`, which has
 *  no fixed range — the caller keeps whatever the user picked. */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>): DateRange {
  const today = new Date();
  const to = toIsoDate(today);

  switch (preset) {
    case 'today':
      return { from: to, to };
    case '7d': {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from: toIsoDate(from), to };
    }
    case '30d': {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from: toIsoDate(from), to };
    }
    case 'mtd':
      return { from: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    case 'qtd': {
      const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
      return { from: toIsoDate(new Date(today.getFullYear(), quarterStartMonth, 1)), to };
    }
  }
}

/**
 * Every bucket start date the backend's `getRevenueSeries` could have
 * produced for this range/granularity — mirrors its SQL bucketing exactly
 * (day: every calendar day; week: Monday-based ISO week, keyed by its
 * Monday; month: keyed by the 1st) so gap-filling below can never disagree
 * with the server about where a bucket boundary falls.
 */
export function enumerateBuckets(range: DateRange, granularity: Granularity): string[] {
  const [fromY, fromM, fromD] = range.from.split('-').map(Number);
  const [toY, toM, toD] = range.to.split('-').map(Number);
  const from = new Date(fromY!, fromM! - 1, fromD);
  const to = new Date(toY!, toM! - 1, toD);

  const buckets: string[] = [];

  if (granularity === 'month') {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= end) {
      buckets.push(toIsoDate(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  const seen = new Set<string>();
  const cursor = new Date(from);
  while (cursor <= to) {
    let key: string;
    if (granularity === 'week') {
      const day = cursor.getDay(); // 0 = Sunday .. 6 = Saturday
      const diffToMonday = day === 0 ? 6 : day - 1;
      const monday = new Date(cursor);
      monday.setDate(monday.getDate() - diffToMonday);
      key = toIsoDate(monday);
    } else {
      key = toIsoDate(cursor);
    }

    if (!seen.has(key)) {
      seen.add(key);
      buckets.push(key);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

export interface RevenueGapPoint {
  /** Bucket start date, ISO. */
  date: string;
  /**
   * `null` means no order landed in this bucket — a real gap, not a zero.
   * This project's rule is "never fabricate a value" (see CLAUDE.md /
   * reports.service.ts): the backend only returns rows for buckets that had
   * activity, so an interpolated zero here would claim certainty ("nothing
   * sold") the data doesn't have. `null` lets the chart render an honest
   * break instead of a false flat line.
   */
  revenue: number | null;
}

/**
 * Fills every bucket the range/granularity implies but the backend didn't
 * return (because nothing happened in it) with `revenue: null`, so a
 * time-scaled x-axis gets one entry per real calendar bucket instead of
 * silently equal-spacing whatever sparse set of dates happened to have
 * orders.
 */
export function fillRevenueGaps(
  points: readonly { date: string; revenue: string }[],
  range: DateRange,
  granularity: Granularity,
): RevenueGapPoint[] {
  const byDate = new Map(points.map((point) => [point.date, Number(point.revenue)]));

  return enumerateBuckets(range, granularity).map((date) => ({
    date,
    revenue: byDate.has(date) ? byDate.get(date)! : null,
  }));
}

/**
 * Exclusive end of the bucket starting at `date` — the moment the bucket's
 * data could no longer change. Used to tell a still-accumulating "today" /
 * "this week" / "this month" bucket apart from a settled one.
 */
export function bucketEnd(date: string, granularity: Granularity): Date {
  const [y, m, d] = date.split('-').map(Number);
  const end = new Date(y!, m! - 1, d);

  if (granularity === 'month') end.setMonth(end.getMonth() + 1);
  else if (granularity === 'week') end.setDate(end.getDate() + 7);
  else end.setDate(end.getDate() + 1);

  return end;
}

/** Reverse lookup: does this exact range match one of the fixed presets?
 *  Drives which preset shows as selected — a custom range that happens not
 *  to match any preset falls through to `null`, which the field reads as
 *  "Custom" (whatever the user actually picked, never forced into a
 *  best-guess preset label). */
export function presetForRange(range: DateRange): Exclude<RangePreset, 'custom'> | null {
  const presets: Exclude<RangePreset, 'custom'>[] = ['today', '7d', '30d', 'mtd', 'qtd'];
  return presets.find((preset) => {
    const computed = rangeForPreset(preset);
    return computed.from === range.from && computed.to === range.to;
  }) ?? null;
}
