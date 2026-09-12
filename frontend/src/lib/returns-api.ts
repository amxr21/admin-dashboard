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
  /** Which branch this belongs to. Null when it predates branch scoping, or
   *  its branch was removed — the UI shows nothing rather than a guess. */
  branch: { id: string; name: string; code: string | null } | null;
  /** A WARNING, not a gate (B4.11) — a return past the window still shows
   *  up here and can still be approved; this just flags it. */
  withinWindow: boolean;
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
  /** The restocking fee actually applied at approval (B4.11), 0-100 as a 2dp
   *  string. Null until a REFUND resolves — never "0 defaulting silently",
   *  since a genuine 0% (waived on purpose) and "not resolved yet" are
   *  different facts. */
  restockingFeePercent: string | null;
  restocked: boolean;
  /** Staff's own words for the rejection. Null on anything not (yet) rejected. */
  rejectionReason: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; status: string };
  customer: { id: string; name: string; email: string } | null;
  items: ReturnItemDetail[];
  /** A warning, not a gate (B4.11) — see `ReturnListRow.withinWindow`. */
  withinWindow: boolean;
  daysSincePurchase: number;
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

/**
 * Why a refund was GIVEN (URG-009) — mirrors the backend enum through a
 * frontend-only shared contract, with no Prisma dependency in the client.
 *
 * Distinct from the requester's own return `category`: that is why the customer
 * says they are sending it back, this is why staff chose to refund. They can
 * legitimately disagree.
 */
export { REFUND_REASONS } from './refund-reasons';
export type { RefundReason } from './refund-reasons';
import type { RefundReason } from './refund-reasons';

export interface ApproveReturnInput {
  resolution: Exclude<ReturnResolution, 'NONE'>;
  refundAmount?: string;
  /** Required when resolution is REFUND, refused otherwise (URG-009). */
  refundReason?: RefundReason;
  /** Required free text when the reason is OTHER, and only then. */
  refundReasonNote?: string;
  restock: boolean;
  /** Proof a manager approved in place (O9.7) — required when the caller is
   *  a cashier, ignored otherwise. Verified server-side against the
   *  signature, never trusted as a bare claim. */
  overrideToken?: string;
  /** A restocking fee (B4.11), 0-100. Omit to use the store default — the
   *  person approving may still raise or waive it for this one return. */
  restockingFeePercent?: number;
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

export async function rejectReturn(
  id: string,
  rejectionReason: string,
  overrideToken?: string,
): Promise<ReturnDetail> {
  const body = await apiFetch<{ return: ReturnDetail }>(`/returns/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejectionReason, ...(overrideToken ? { overrideToken } : {}) }),
  });
  return body.return;
}
