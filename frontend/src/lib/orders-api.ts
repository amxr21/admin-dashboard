import { apiFetch } from '@/lib/api';

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
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: string | null;
  paymentMethod: string | null;
  placedAt: string;
  /** Staff-only, never surfaced to the customer. Null when never set. */
  internalNotes: string | null;
  customer: OrderCustomer | null;
  items: OrderItem[];
  statusHistory: OrderStatusEntry[];
  assignment: {
    id: string;
    status: string;
    address: string | null;
    city: string | null;
    /** Failed delivery attempts so far. Never reset by a retry. */
    attemptCount: number;
    /** Most recent courier-reported failure reason; full history is in AuditLog. */
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

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** `YYYY-MM-DD`, inclusive at both ends. */
  from?: string;
  to?: string;
  search?: string;
}

export async function fetchOrders(params: OrderListParams = {}): Promise<OrderListResult> {
  const query = new URLSearchParams();

  // Empty values are omitted rather than sent blank: the API validates the
  // status enum strictly, so `status=` would be a 400.
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return apiFetch<OrderListResult>(`/orders?${query.toString()}`);
}

export async function fetchOrder(id: string): Promise<OrderDetail> {
  const body = await apiFetch<{ order: OrderDetail }>(`/orders/${id}`);
  return body.order;
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

/** `internalNotes: ''` clears the field — the server stores that as null. */
export async function updateOrderNotes(id: string, internalNotes: string): Promise<OrderDetail> {
  const body = await apiFetch<{ order: OrderDetail }>(`/orders/${id}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ internalNotes }),
  });
  return body.order;
}
