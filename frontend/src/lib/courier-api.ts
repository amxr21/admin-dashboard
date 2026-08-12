import { ApiError } from '@/lib/api';
import { readCourierToken, type CourierSession } from '@/lib/courier-auth-storage';

/**
 * Client for the courier-facing API (`/courier/...`) — a separate fetch
 * wrapper from `apiFetch`, not a shared one with a flag, because it reads a
 * DIFFERENT token (`readCourierToken`, never `readToken`). Sharing one
 * function between the two auth surfaces would be exactly the kind of
 * accidental cross-wiring `courier-auth-storage.ts`'s separate keys exist to
 * prevent.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type ErrorBody = {
  error?: { code?: string; message?: string; requestId?: string; details?: unknown };
};

async function courierFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readCourierToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // leave body empty
    }

    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN_ERROR',
      body.error?.message ?? `Request failed with status ${response.status}`,
      body.error?.requestId ?? undefined,
      body.error?.details,
    );
  }

  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as { data: T };
  return body.data;
}

export interface CourierLoginResult {
  token: string;
  courier: CourierSession;
}

export async function courierLogin(code: string): Promise<CourierLoginResult> {
  return courierFetch<CourierLoginResult>('/courier/auth', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export type DeliveryStatus =
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'HANDED_OVER'
  | 'CANCELED'
  | 'RETURNED'
  | 'FAILED_ATTEMPT';

export interface CourierAssignment {
  id: string;
  status: DeliveryStatus;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  area: string | null;
  city: string | null;
  total: string | null;
  paymentMethod: string | null;
  note: string | null;
  /** How many delivery attempts have failed so far for this assignment. */
  attemptCount: number;
  /** The courier's own words for why the most recent attempt failed. */
  failureReason: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string };
}

export async function fetchMyAssignments(): Promise<CourierAssignment[]> {
  const result = await courierFetch<{ assignments: CourierAssignment[] }>(
    '/courier/me/assignments',
  );
  return result.assignments;
}

export async function updateAssignmentStatus(
  id: string,
  status: DeliveryStatus,
  failureReason?: string,
): Promise<CourierAssignment> {
  const result = await courierFetch<{ assignment: CourierAssignment }>(
    `/courier/assignments/${id}/status`,
    { method: 'PATCH', body: JSON.stringify({ status, ...(failureReason ? { failureReason } : {}) }) },
  );
  return result.assignment;
}
