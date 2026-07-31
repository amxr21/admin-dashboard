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

export interface ReturnListRow {
  id: string;
  rmaNumber: string;
  status: ReturnStatus;
  resolution: ReturnResolution;
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
  status: ReturnStatus;
  resolution: ReturnResolution;
  refundAmount: string | null;
  restocked: boolean;
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

export async function rejectReturn(id: string): Promise<ReturnDetail> {
  const body = await apiFetch<{ return: ReturnDetail }>(`/returns/${id}/reject`, {
    method: 'POST',
  });
  return body.return;
}
