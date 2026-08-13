import { apiFetch } from '@/lib/api';

/**
 * Client for the bespoke returns routes (`/api/v1/returns`).
 *
 * Not the resource engine, same reason orders isn't: approving a return is a
 * procedure (validate the order can move to RETURNED, optionally restock,
 * record a resolution), not a row you edit.
 *
 * Money stays a string throughout — format for display, never calculate.
 */

export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';
export type ReturnResolution = 'NONE' | 'REFUND' | 'STORE_CREDIT' | 'REPLACEMENT';
export type ReturnCategory =
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'NOT_AS_DESCRIBED'
  | 'NO_LONGER_NEEDED'
  | 'ARRIVED_LATE'
  | 'OTHER';

export interface ReturnListRow {
  id: string;
  rmaNumber: string;
  status: ReturnStatus;
  resolution: ReturnResolution;
  /** Null on any return requested before this was tracked, or where the
   *  requester skipped it — it's optional alongside the free-text reason. */
  category: ReturnCategory | null;
  createdAt: string;
  order: { id: string; orderNumber: string };
  customer: { id: string; name: string } | null;
  itemCount: number;
}

export interface ReturnItemDetail {
  id: string;
  quantity: number;
  orderItemId: string;
  price: string | null;
  lineTotal: string;
  product: { id: string; name: string; sku: string | null } | null;
}

export interface ReturnDetail {
  id: string;
  rmaNumber: string;
  reason: string;
  category: ReturnCategory | null;
  status: ReturnStatus;
  resolution: ReturnResolution;
  refundAmount: string | null;
  restocked: boolean;
  /** Staff's own words for the rejection. Null on anything not (yet) rejected. */
  rejectionReason: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; status: string };
  customer: { id: string; name: string; email: string } | null;
  items: ReturnItemDetail[];
}

export interface ReturnListResult {
  returns: ReturnListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReturnListParams {
  page?: number;
  pageSize?: number;
  status?: ReturnStatus;
  search?: string;
}

export async function fetchReturns(params: ReturnListParams = {}): Promise<ReturnListResult> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return apiFetch<ReturnListResult>(`/returns?${query.toString()}`);
}

export async function fetchReturn(id: string): Promise<ReturnDetail> {
  const body = await apiFetch<{ return: ReturnDetail }>(`/returns/${id}`);
  return body.return;
}

export interface CreateReturnInput {
  orderId: string;
  reason: string;
  category?: ReturnCategory;
  items: { orderItemId: string; quantity: number }[];
}

export async function createReturn(input: CreateReturnInput): Promise<ReturnDetail> {
  const body = await apiFetch<{ return: ReturnDetail }>('/returns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.return;
}

export interface ApproveReturnInput {
  resolution: Exclude<ReturnResolution, 'NONE'>;
  refundAmount?: string;
  restock: boolean;
}

export async function approveReturn(
  id: string,
  input: ApproveReturnInput,
): Promise<ReturnDetail> {
  const body = await apiFetch<{ return: ReturnDetail }>(`/returns/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.return;
}

export async function rejectReturn(id: string, rejectionReason: string): Promise<ReturnDetail> {
  const body = await apiFetch<{ return: ReturnDetail }>(`/returns/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejectionReason }),
  });
  return body.return;
}
