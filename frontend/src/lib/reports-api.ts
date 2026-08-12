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
  unitsSold: number;
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

export interface NeedsAttention {
  returnsAwaitingApproval: {
    count: number;
    items: { id: string; rmaNumber: string; orderNumber: string; createdAt: string }[];
  };
  reviewsAwaitingModeration: {
    count: number;
    items: { id: string; rating: number; productName: string | null; createdAt: string }[];
  };
  unassignedDeliveries: {
    count: number;
    items: { id: string; orderNumber: string; status: string; placedAt: string }[];
  };
  outOfStockWithOpenOrders: {
    count: number;
    items: { id: string; name: string; sku: string | null; stock: number }[];
  };
}

export interface StaffActivity {
  range: DateRange;
  staff: {
    actorId: string | null;
    actorEmail: string;
    actorRole: string | null;
    actionCount: number;
    deniedCount: number;
  }[];
  windowStart: string;
  windowEnd: string;
}

export interface CategoryBreakdown {
  range: DateRange;
  categories: {
    categoryId: string | null;
    /** "(uncategorised)" for a product with no category (or a hard-deleted one) — never dropped silently. */
    categoryName: string;
    units: number;
    revenue: string;
  }[];
}

export interface RefundRateTrend {
  range: DateRange;
  points: { date: string; revenue: string; refunded: string; refundRate: number }[];
}

export interface InventoryTurnover {
  range: DateRange;
  turnover: { productId: string; name: string; sku: string | null; stock: number; unitsSold: number }[];
  /** Carries stock but sold nothing in the window. */
  deadStock: { productId: string; name: string; sku: string | null; stock: number; unitsSold: number }[];
}

export type ExplorerDimension = Granularity | 'status' | 'category' | 'product' | 'paymentMethod';

export const EXPLORER_DIMENSIONS: ExplorerDimension[] = [
  'day',
  'week',
  'month',
  'status',
  'category',
  'product',
  'paymentMethod',
];

export function isExplorerDimension(value: string): value is ExplorerDimension {
  return (EXPLORER_DIMENSIONS as readonly string[]).includes(value);
}

export interface ExplorerRow {
  key: string | null;
  label: string;
  revenue: string;
  units: number;
  orders: number;
  averageOrderValue: string;
}

export interface Explorer {
  range: DateRange;
  dimension: ExplorerDimension;
  rows: ExplorerRow[];
}

export type ExplorerMeasure = 'revenue' | 'units' | 'orders' | 'averageOrderValue';

export const EXPLORER_MEASURES: ExplorerMeasure[] = ['revenue', 'units', 'orders', 'averageOrderValue'];

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

/** No range params — deliberately live state, not scoped to the dashboard's
 *  selected window. See `getNeedsAttention`'s own doc comment. */
export async function fetchNeedsAttention(): Promise<NeedsAttention> {
  return apiFetch<NeedsAttention>('/reports/needs-attention');
}

export async function fetchStaffActivity(range: DateRange): Promise<StaffActivity> {
  return apiFetch<StaffActivity>(`/reports/staff-activity?${query({ ...range })}`);
}

export async function fetchCategoryBreakdown(range: DateRange): Promise<CategoryBreakdown> {
  return apiFetch<CategoryBreakdown>(`/reports/category-breakdown?${query({ ...range })}`);
}

export async function fetchRefundRateTrend(range: DateRange): Promise<RefundRateTrend> {
  return apiFetch<RefundRateTrend>(`/reports/refund-rate-trend?${query({ ...range })}`);
}

export async function fetchInventoryTurnover(range: DateRange): Promise<InventoryTurnover> {
  return apiFetch<InventoryTurnover>(`/reports/inventory-turnover?${query({ ...range })}`);
}

export async function fetchExplorer(range: DateRange, dimension: ExplorerDimension): Promise<Explorer> {
  return apiFetch<Explorer>(`/reports/explorer?${query({ ...range, dimension })}`);
}

// ─── C3.5 (second batch) — customer, product, inventory, returns, delivery,
// audit domain reports. Same shape discipline as everything above: money
// stays a string, an absence renders as an explicit bucket the backend
// already computed, never re-derived here.

export interface CustomerGeography {
  range: DateRange;
  rows: { city: string; country: string; revenue: string; orders: number }[];
}
export async function fetchCustomerGeography(range: DateRange): Promise<CustomerGeography> {
  return apiFetch<CustomerGeography>(`/reports/customer-geography?${query({ ...range })}`);
}

export interface CustomerNewVsReturning {
  range: DateRange;
  new: { revenue: string; orders: number };
  returning: { revenue: string; orders: number };
}
export async function fetchCustomerNewVsReturning(range: DateRange): Promise<CustomerNewVsReturning> {
  return apiFetch<CustomerNewVsReturning>(`/reports/customer-new-vs-returning?${query({ ...range })}`);
}

export interface CustomerLifetimeValue {
  customers: {
    customerId: string;
    name: string;
    email: string;
    revenue: string;
    orders: number;
    averageOrderValue: string;
  }[];
}
/** No range — LTV is a running all-time total, not scoped to a window. */
export async function fetchCustomerLifetimeValue(limit?: number): Promise<CustomerLifetimeValue> {
  return apiFetch<CustomerLifetimeValue>(`/reports/customer-lifetime-value?${query({ limit })}`);
}

export interface CustomerOrderFrequency {
  range: DateRange;
  buckets: { label: string; customers: number }[];
  totalCustomers: number;
  repeatRate: number;
}
export async function fetchCustomerOrderFrequency(range: DateRange): Promise<CustomerOrderFrequency> {
  return apiFetch<CustomerOrderFrequency>(`/reports/customer-order-frequency?${query({ ...range })}`);
}

export interface GuestVsRegistered {
  range: DateRange;
  guest: { revenue: string; orders: number };
  registered: { revenue: string; orders: number };
}
export async function fetchGuestVsRegistered(range: DateRange): Promise<GuestVsRegistered> {
  return apiFetch<GuestVsRegistered>(`/reports/guest-vs-registered?${query({ ...range })}`);
}

export interface PaymentMethodBreakdown {
  range: DateRange;
  methods: { paymentMethod: string; revenue: string; orders: number }[];
}
export async function fetchPaymentMethodBreakdown(range: DateRange): Promise<PaymentMethodBreakdown> {
  return apiFetch<PaymentMethodBreakdown>(`/reports/payment-method-breakdown?${query({ ...range })}`);
}

export interface ProductMargin {
  range: DateRange;
  products: {
    productId: string;
    name: string;
    sku: string | null;
    revenue: string;
    cogs: string;
    margin: string;
    marginPercent: number;
    units: number;
  }[];
  /** A count, not a list — every OTHER product sold in the window that has
   *  no recorded cost, so the gap is visible without duplicating the
   *  catalogue's own product list. */
  productsWithoutCost: number;
}
export async function fetchProductMargin(range: DateRange): Promise<ProductMargin> {
  return apiFetch<ProductMargin>(`/reports/product-margin?${query({ ...range })}`);
}

export interface ProductReviewSummary {
  range: DateRange;
  products: {
    productId: string;
    name: string;
    reviewCount: number;
    averageRating: number;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  }[];
}
export async function fetchProductReviewSummary(range: DateRange): Promise<ProductReviewSummary> {
  return apiFetch<ProductReviewSummary>(`/reports/product-review-summary?${query({ ...range })}`);
}

export interface ReviewModerationThroughput {
  range: DateRange;
  submitted: number;
  approved: number;
  rejected: number;
  pending: number;
  averageHoursToModeration: number | null;
}
export async function fetchReviewModerationThroughput(range: DateRange): Promise<ReviewModerationThroughput> {
  return apiFetch<ReviewModerationThroughput>(`/reports/review-moderation-throughput?${query({ ...range })}`);
}

export interface ProductsWithoutReviews {
  products: { productId: string; name: string; sku: string | null }[];
}
/** No range — live catalogue state, same as needs-attention. */
export async function fetchProductsWithoutReviews(): Promise<ProductsWithoutReviews> {
  return apiFetch<ProductsWithoutReviews>('/reports/products-without-reviews');
}

export interface LowStockSnapshot {
  threshold: number;
  products: { productId: string; name: string; sku: string | null; stock: number; daysSinceLastRestock: number | null }[];
}
/** No range — live catalogue state, same as needs-attention. */
export async function fetchLowStockSnapshot(): Promise<LowStockSnapshot> {
  return apiFetch<LowStockSnapshot>('/reports/low-stock-snapshot');
}

export interface StockAdjustmentReasons {
  range: DateRange;
  reasons: { reason: string; movements: number; netUnits: number }[];
}
export async function fetchStockAdjustmentReasons(range: DateRange): Promise<StockAdjustmentReasons> {
  return apiFetch<StockAdjustmentReasons>(`/reports/stock-adjustment-reasons?${query({ ...range })}`);
}

export interface VariantStockMovement {
  range: DateRange;
  variants: {
    variantId: string;
    name: string;
    productName: string;
    sku: string | null;
    stock: number;
    sold: number;
    received: number;
  }[];
}
export async function fetchVariantStockMovement(range: DateRange): Promise<VariantStockMovement> {
  return apiFetch<VariantStockMovement>(`/reports/variant-stock-movement?${query({ ...range })}`);
}

export interface ReturnResolutionBreakdown {
  range: DateRange;
  byResolution: { resolution: string; count: number; refundedValue: string }[];
  byStatus: { status: string; count: number }[];
}
export async function fetchReturnResolutionBreakdown(range: DateRange): Promise<ReturnResolutionBreakdown> {
  return apiFetch<ReturnResolutionBreakdown>(`/reports/return-resolution-breakdown?${query({ ...range })}`);
}

export interface ReturnReasons {
  range: DateRange;
  returns: { rmaNumber: string; reason: string; status: string; createdAt: string }[];
}
export async function fetchReturnReasons(range: DateRange): Promise<ReturnReasons> {
  return apiFetch<ReturnReasons>(`/reports/return-reasons?${query({ ...range })}`);
}

export interface CourierPerformance {
  range: DateRange;
  couriers: { driverId: string; name: string; total: number; byStatus: Record<string, number> }[];
}
export async function fetchCourierPerformance(range: DateRange): Promise<CourierPerformance> {
  return apiFetch<CourierPerformance>(`/reports/courier-performance?${query({ ...range })}`);
}

export interface DeliveryZoneBreakdown {
  range: DateRange;
  zones: { zone: string; region: string; assignments: number; collectibleValue: string }[];
}
export async function fetchDeliveryZoneBreakdown(range: DateRange): Promise<DeliveryZoneBreakdown> {
  return apiFetch<DeliveryZoneBreakdown>(`/reports/delivery-zone-breakdown?${query({ ...range })}`);
}

export interface DeliveryCycleTime {
  range: DateRange;
  deliveredCount: number;
  averageHours: number | null;
  medianHours: number | null;
}
export async function fetchDeliveryCycleTime(range: DateRange): Promise<DeliveryCycleTime> {
  return apiFetch<DeliveryCycleTime>(`/reports/delivery-cycle-time?${query({ ...range })}`);
}

export interface CourierWorkloadSnapshot {
  byStatus: { status: string; count: number }[];
  couriers: { driverId: string; name: string; status: string; openAssignments: number }[];
}
/** No range — live roster state, same as needs-attention. */
export async function fetchCourierWorkloadSnapshot(): Promise<CourierWorkloadSnapshot> {
  return apiFetch<CourierWorkloadSnapshot>('/reports/courier-workload-snapshot');
}

export interface AuditOutcomeTrend {
  range: DateRange;
  points: { date: string; success: number; denied: number; error: number }[];
}
export async function fetchAuditOutcomeTrend(range: DateRange): Promise<AuditOutcomeTrend> {
  return apiFetch<AuditOutcomeTrend>(`/reports/audit-outcome-trend?${query({ ...range })}`);
}

export interface AuditActivityByEntity {
  range: DateRange;
  rows: { entity: string; action: string; count: number }[];
}
export async function fetchAuditActivityByEntity(range: DateRange): Promise<AuditActivityByEntity> {
  return apiFetch<AuditActivityByEntity>(`/reports/audit-activity-by-entity?${query({ ...range })}`);
}

/**
 * Every view the backend can render as an export — all eight, matching
 * `reports.route.ts`. This union used to list only four, which made the
 * exports the server already emitted for fulfillment-health, returns-summary
 * and order-value-distribution unreachable from the UI.
 */
export type ReportView =
  | 'overview'
  | 'revenue'
  | 'top-products'
  | 'status-breakdown'
  | 'fulfillment-health'
  | 'returns-summary'
  | 'order-value-distribution'
  | 'staff-activity'
  | 'category-breakdown'
  | 'refund-rate-trend'
  | 'inventory-turnover'
  | 'explorer'
  | 'customer-geography'
  | 'customer-new-vs-returning'
  | 'customer-lifetime-value'
  | 'customer-order-frequency'
  | 'guest-vs-registered'
  | 'payment-method-breakdown'
  | 'product-margin'
  | 'product-review-summary'
  | 'review-moderation-throughput'
  | 'products-without-reviews'
  | 'low-stock-snapshot'
  | 'stock-adjustment-reasons'
  | 'variant-stock-movement'
  | 'return-resolution-breakdown'
  | 'return-reasons'
  | 'courier-performance'
  | 'delivery-zone-breakdown'
  | 'delivery-cycle-time'
  | 'courier-workload-snapshot'
  | 'audit-outcome-trend'
  | 'audit-activity-by-entity';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];

/** Same endpoint as the JSON fetch above, `format` picks the file the server
 *  renders instead of the shape changing (C3.4 added xlsx/pdf alongside the
 *  original csv). */
export async function downloadReport(
  view: ReportView,
  range: DateRange,
  format: ExportFormat = 'csv',
  extra: Record<string, string | number | undefined> = {},
): Promise<void> {
  const search = query({ ...range, ...extra, format });
  await apiDownload(`/reports/${view}?${search}`, `${view}.${format}`);
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

export interface OrdersGapPoint {
  /** Bucket start date, ISO. */
  date: string;
  /** Same "missing row is a gap, not a zero" rule as `RevenueGapPoint`. */
  orders: number | null;
}

/**
 * Same gap-filling as `fillRevenueGaps`, over the `orders` count each bucket
 * of `getRevenueSeries` already carries — for the Orders KPI tile's
 * sparkline (C1.3). Kept separate from `fillRevenueGaps` rather than made to
 * return both fields: most callers of that function only want revenue, and
 * widening its return shape would ripple into every existing caller for a
 * field only one new consumer needs.
 */
export function fillOrdersGaps(
  points: readonly { date: string; orders: number }[],
  range: DateRange,
  granularity: Granularity,
): OrdersGapPoint[] {
  const byDate = new Map(points.map((point) => [point.date, point.orders]));

  return enumerateBuckets(range, granularity).map((date) => ({
    date,
    orders: byDate.has(date) ? byDate.get(date)! : null,
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

/**
 * The orders-list URL a chart drill-down click (C1.6) lands on — extracted
 * as a pure function so the actual date arithmetic is unit-testable without
 * involving Recharts or a real pointer event, neither of which jsdom can
 * simulate meaningfully for an SVG chart.
 *
 * `bucketEnd` is EXCLUSIVE (see its own doc comment) but the orders table's
 * `to` filter is INCLUSIVE end-of-day (orders.service.ts) — one day back
 * turns "start of the next bucket" into "the last real day of this one".
 */
export function drillDownHref(bucketStartDate: string, granularity: Granularity): string {
  const inclusiveEnd = bucketEnd(bucketStartDate, granularity);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);

  return `/admin/orders?from=${bucketStartDate}&to=${toIsoDate(inclusiveEnd)}`;
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
