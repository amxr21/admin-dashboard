import { apiFetch } from '@/lib/api';

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
