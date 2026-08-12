import { apiDownload, apiFetch } from '@/lib/api';

/**
 * Client for the bespoke orders routes (`/api/v1/orders`).
 *
 * Orders is NOT served by the resource engine — three tables and a lifecycle
 * are not something a config block can describe — so this is hand-written
 * rather than going through `resource-api.ts`.
 *
 * Money stays a STRING throughout, as everywhere else. The API sends "59.98";
 * parsing it into a JS number here would reintroduce the float error the
 * string form exists to avoid. Format for display, never calculate.
 */

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELED'
  | 'RETURNED';

export interface OrderCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface OrderListRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: string | null;
  placedAt: string;
  paymentMethod: string | null;
  customer: OrderCustomer | null;
  itemCount: number;
}

export interface OrderItem {
  id: string;
  quantity: number;
  price: string | null;
  lineTotal: string;
  productId: string | null;
  /** Null when the product was hard-deleted — there is no name snapshot. */
  product: { id: string; name: string; sku: string | null; imageUrl: string | null } | null;
}

export interface OrderStatusEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  changedById: string | null;
  /** Null when the staff account has since been deleted — the id survives, the name doesn't. */
  changedByName: string | null;
  createdAt: string;
}

export interface OrderNote {
  id: string;
  body: string;
  authorId: string | null;
  /** Null when the staff account has since been deleted — the id survives, the name doesn't. */
  authorName: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  /** Grand total — what the customer paid, tax included. Never recomputed. */
  total: string | null;
  /** Sum of line items before tax. Null on orders placed before this was
   *  tracked — a real "never recorded" gap, not a confirmed zero. */
  subtotal: string | null;
  /** Tax charged at the time of the order. Same null-means-unrecorded rule
   *  as `subtotal`. */
  taxAmount: string | null;
  paymentMethod: string | null;
  placedAt: string;
  /** Staff-only, never surfaced to the customer — a THREAD (C5.7), oldest first. */
  notes: OrderNote[];
  customer: OrderCustomer | null;
  items: OrderItem[];
  statusHistory: OrderStatusEntry[];
  assignment: {
    id: string;
    status: string;
    address: string | null;
    city: string | null;
    /** How many delivery attempts have failed so far. */
    attemptCount: number;
    /** The courier's own words for why the most recent attempt failed. */
    failureReason: string | null;
    driver: { id: string; name: string; phone: string | null } | null;
  } | null;
  /**
   * Only the moves the server would accept. The UI builds its status control
   * from this rather than from a local copy of the table, so an illegal move
   * is never offered and the two can never disagree.
   */
  nextStatuses: OrderStatus[];
}

export interface OrderListResult {
  orders: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Columns the backend can sort by directly — mirrors OrderSortField in
 *  orders.service.ts. Item count and customer are NOT here: one is a Prisma
 *  `_count`, the other a relation field, and a flat `orderBy` can't sort by
 *  either. */
export type OrderSortField = 'orderNumber' | 'placedAt' | 'total' | 'status';

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** `YYYY-MM-DD`, inclusive at both ends. */
  from?: string;
  to?: string;
  search?: string;
  sort?: OrderSortField;
  dir?: 'asc' | 'desc';
}

/** Shared by `fetchOrders` and `exportOrdersCsv` — both send the same filter
 *  shape to the same endpoint, only the format differs. Empty values are
 *  omitted rather than sent blank: the API validates the status enum
 *  strictly, so `status=` would be a 400. */
function toOrderQuery(params: object): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value as string | number));
    }
  }

  return query.toString();
}

export async function fetchOrders(params: OrderListParams = {}): Promise<OrderListResult> {
  return apiFetch<OrderListResult>(`/orders?${toOrderQuery(params)}`);
}

/**
 * Downloads every order matching the given filters as CSV — same query the
 * list view would send, only `format=csv` differs, matching the exact
 * convention `exportAuditCsv` already established. Exports the FILTER, not
 * the visible page: a manager asking for "every shipped order this month"
 * means all of them, not the 20 currently on screen.
 */
export async function exportOrdersCsv(
  params: Omit<OrderListParams, 'page' | 'pageSize'> = {},
): Promise<void> {
  await apiDownload(`/orders?${toOrderQuery({ ...params, format: 'csv' })}`, 'orders.csv');
}

export async function fetchOrder(id: string): Promise<OrderDetail> {
  const body = await apiFetch<{ order: OrderDetail }>(`/orders/${id}`);
  return body.order;
}

export type TimelineEventKind = 'status' | 'note' | 'delivery' | 'return' | 'other';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  action: string;
  actorName: string | null;
  createdAt: string;
  /** Shape differs per `kind` — see orders.service.ts's `getOrderTimeline`. */
  detail: Record<string, unknown>;
}

/**
 * Every real event touching this order, newest first (C5.4): status moves,
 * staff edits, delivery-status pings and return decisions. Deliberately does
 * NOT include "emails sent" — there is no order-lifecycle customer email
 * feature in this app to log (see orders.service.ts's own doc comment).
 */
export async function fetchOrderTimeline(id: string): Promise<TimelineEvent[]> {
  const body = await apiFetch<{ events: TimelineEvent[] }>(`/orders/${id}/timeline`);
  return body.events;
}

export interface OrderNeighbor {
  id: string;
  orderNumber: string;
}

export interface OrderNeighbors {
  prev: OrderNeighbor | null;
  next: OrderNeighbor | null;
}

/**
 * Prev/next within the same filtered, sorted list the caller arrived from —
 * `filters` is the exact query the orders table itself sent, carried over
 * via the row link so this can never show a neighbor the list wouldn't.
 */
export async function fetchOrderNeighbors(
  id: string,
  filters: Omit<OrderListParams, 'page' | 'pageSize'>,
): Promise<OrderNeighbors> {
  return apiFetch<OrderNeighbors>(`/orders/${id}/neighbors?${toOrderQuery(filters)}`);
}

export async function changeOrderStatus(
  id: string,
  to: OrderStatus,
  note?: string,
): Promise<OrderDetail> {
  const body = await apiFetch<{ order: OrderDetail }>(`/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(note ? { to, note } : { to }),
  });
  return body.order;
}

export interface BulkStatusResult {
  succeeded: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Moves several orders to the same target status in one request.
 *
 * Best-effort, same as the resource engine's bulk delete: one order having
 * moved on since the list was fetched must not block the others, so the
 * response reports per-id success/skip rather than an all-or-nothing
 * pass/fail. Every id is validated against its OWN current status server-side
 * (`bulkChangeOrderStatus` in orders.service.ts loops the same
 * `changeOrderStatus` a single-order PATCH uses) — there is no second copy of
 * the transition table here or on the server for this to drift from.
 */
export async function bulkChangeOrderStatus(
  ids: string[],
  to: OrderStatus,
  note?: string,
): Promise<BulkStatusResult> {
  const body = await apiFetch<BulkStatusResult>('/orders/bulk-status', {
    method: 'POST',
    body: JSON.stringify(note ? { ids, to, note } : { ids, to }),
  });
  return body;
}

export interface BulkStatusPreview {
  eligibleCount: number;
  ineligibleCount: number;
  /** Eligible orders that also carry a live courier assignment this move
   *  would push forward — the dependency a bare selection count hides. */
  withActiveAssignment: number;
  /** Once applied, none of the affected orders can be moved again. */
  isTerminal: boolean;
}

/**
 * What a bulk status change WOULD do (C5.5) — read before the real POST, so
 * the confirmation dialog can name a real dependency count and flag a
 * terminal target instead of a generic "are you sure?". Read-only; reuses
 * the exact same eligibility check the real move validates against.
 */
export async function previewBulkStatusChange(
  ids: string[],
  to: OrderStatus,
): Promise<BulkStatusPreview> {
  return apiFetch<BulkStatusPreview>('/orders/bulk-status/preview', {
    method: 'POST',
    body: JSON.stringify({ ids, to }),
  });
}

/**
 * Adds a note to the order's thread (C5.7) — this ADDS, it does not
 * overwrite whatever the last person wrote. Returns the whole order so the
 * caller gets the new note back already merged into `notes`.
 */
export async function addOrderNote(id: string, body: string): Promise<OrderDetail> {
  const result = await apiFetch<{ order: OrderDetail }>(`/orders/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return result.order;
}
