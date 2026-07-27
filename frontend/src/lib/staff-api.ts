import { apiFetch } from '@/lib/api';

/**
 * Client for `/api/v1/staff`.
 *
 * ─── THE UI MIRRORS THE RULES; THE SERVER ENFORCES THEM ──────────────
 * `rankOf` and `canAssign` below exist so a control the server would refuse is
 * disabled rather than offered and then rejected. They are a COURTESY. Every
 * one of these rules is enforced in staff.service.ts, and anyone can call the
 * endpoint directly — so if these two ever disagree with the server, the
 * server is right and this is a bug in the hint, not in the protection.
 */

export type StaffRole =
  | 'DEVELOPER'
  | 'OWNER'
  | 'MANAGER'
  | 'FULFILLMENT'
  | 'SUPPORT'
  | 'DEMO';

/** Highest privilege first. Mirrors ROLE_ORDER in backend config/roles.ts. */
export const STAFF_ROLES: StaffRole[] = [
  'DEVELOPER',
  'OWNER',
  'MANAGER',
  'FULFILLMENT',
  'SUPPORT',
  'DEMO',
];

export function rankOf(role: StaffRole): number {
  const index = STAFF_ROLES.indexOf(role);
  // Unknown means LEAST privileged, matching the server. A role added to the
  // enum but not here must not accidentally outrank everyone.
  return index === -1 ? STAFF_ROLES.length : index;
}

/** At or below the actor's own rank — never above. */
export function canAssign(actor: StaffRole, target: StaffRole): boolean {
  return rankOf(target) >= rankOf(actor);
}

/** Can the actor modify this person at all? Equal rank is allowed; above is not. */
export function canModify(actor: StaffRole, subject: StaffRole): boolean {
  return rankOf(subject) >= rankOf(actor);
}

export interface StaffMember {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  accessExpiresAt: string | null;
  lastLoginAt: string | null;
  /** Non-null means a brute-force lockout is in force. */
  lockedUntil: string | null;
  createdAt: string;
}

export interface StaffListResult {
  staff: StaffMember[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StaffListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: StaffRole;
  isActive?: boolean;
}

export async function fetchStaff(params: StaffListParams = {}): Promise<StaffListResult> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return apiFetch<StaffListResult>(`/staff?${query.toString()}`);
}

export interface CreateStaffInput {
  email: string;
  name?: string;
  phone?: string;
  role: StaffRole;
  password: string;
}

export async function createStaff(input: CreateStaffInput): Promise<StaffMember> {
  const body = await apiFetch<{ staff: StaffMember }>('/staff', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.staff;
}

export interface UpdateStaffInput {
  name?: string;
  phone?: string;
  role?: StaffRole;
  isActive?: boolean;
}

export async function updateStaff(
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember> {
  const body = await apiFetch<{ staff: StaffMember }>(`/staff/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.staff;
}

export async function unlockStaff(id: string): Promise<StaffMember> {
  const body = await apiFetch<{ staff: StaffMember }>(`/staff/${id}/unlock`, {
    method: 'POST',
  });
  return body.staff;
}

/**
 * Set someone else's password.
 *
 * Returns the staff record, deliberately NOT the password — the caller typed
 * it and can read their own form. Nothing echoes a credential back.
 */
export async function setStaffPassword(
  id: string,
  password: string,
): Promise<StaffMember> {
  const body = await apiFetch<{ staff: StaffMember }>(`/staff/${id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return body.staff;
}
