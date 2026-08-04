import { apiFetch } from '@/lib/api';

/**
 * Client for the bespoke delivery routes (`/api/v1/couriers`, `/assignments`).
 *
 * Couriers are NOT served by the resource engine, and this file is the reason
 * why: issuing an access code is an action that returns a one-time secret, and
 * config has no vocabulary for that.
 *
 * ─── THE CODE IS NEVER STORED CLIENT-SIDE ────────────────────────────
 * `issueAccessCode` returns the plaintext exactly once. It is held in component
 * state for as long as the panel is open and never written to localStorage, a
 * URL, or anywhere it could outlive the moment — the server keeps only an HMAC,
 * so nothing can recover it afterwards, and that is the point.
 */

export type CourierStatus = 'ACTIVE' | 'ON_SHIFT' | 'INACTIVE';

export const COURIER_STATUSES: CourierStatus[] = ['ACTIVE', 'ON_SHIFT', 'INACTIVE'];

export interface Courier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  vehicleType: string | null;
  plateNumber: string | null;
  zone: string | null;
  region: string | null;
  country: string | null;
  status: CourierStatus;
  createdAt: string;
  /** Whether one exists — never the code itself. */
  hasAccessCode: boolean;
  activeAssignments: number;
}

export interface CourierListResult {
  couriers: Courier[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CourierListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CourierStatus;
}

export async function fetchCouriers(
  params: CourierListParams = {},
): Promise<CourierListResult> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return apiFetch<CourierListResult>(`/couriers?${query.toString()}`);
}

export interface CourierInput {
  name: string;
  email?: string;
  phone?: string;
  vehicleType?: string;
  plateNumber?: string;
  zone?: string;
  region?: string;
  country?: string;
  status?: CourierStatus;
}

export async function createCourier(input: CourierInput): Promise<Courier> {
  const body = await apiFetch<{ courier: Courier }>('/couriers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.courier;
}

export async function updateCourier(
  id: string,
  input: Partial<CourierInput>,
): Promise<Courier> {
  const body = await apiFetch<{ courier: Courier }>(`/couriers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.courier;
}

/**
 * Issue a new code, invalidating any previous one.
 *
 * The returned `code` is the ONLY time it exists in readable form. There is no
 * endpoint to read it back, because the server stored only a hash.
 */
export async function issueAccessCode(
  id: string,
): Promise<{ courier: { id: string; name: string }; code: string }> {
  return apiFetch(`/couriers/${id}/access-code`, { method: 'POST' });
}

export async function revokeAccessCode(id: string): Promise<void> {
  await apiFetch<undefined>(`/couriers/${id}/access-code`, { method: 'DELETE' });
}

export interface Assignment {
  id: string;
  status: string;
  address: string | null;
  city: string | null;
  driver: { id: string; name: string; phone: string | null } | null;
}

export interface AssignCourierInput {
  orderId: string;
  driverId: string;
  address?: string;
  city?: string;
  note?: string;
}

/**
 * Assigns an order to a courier, or reassigns it to a different one.
 *
 * The backend `upsert`s on `orderId` (see `couriers.service.ts`), so calling
 * this again with a different `driverId` on an already-assigned order is a
 * reassignment, not a second row — never call `unassignCourier` first.
 */
export async function assignCourier(input: AssignCourierInput): Promise<Assignment> {
  const body = await apiFetch<{ assignment: Assignment }>('/assignments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.assignment;
}

export async function unassignCourier(assignmentId: string): Promise<void> {
  await apiFetch<undefined>(`/assignments/${assignmentId}`, { method: 'DELETE' });
}
