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
  /**
   * ISO datetime, or `null` to clear it. Silently gates login — see
   * `auth.service.ts` — so leaving it off `UpdateStaffInput` was a real gap:
   * the field was accepted and returned by the API with no way to set it.
   */
  accessExpiresAt?: string | null;
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

export interface ResetTokenResult {
  staff: { id: string; email: string };
  /** Plaintext, returned exactly once — the server stores only an HMAC. */
  token: string;
  expiresAt: string;
}

/**
 * Issue a one-time reset token for someone else.
 *
 * The alternative to `setStaffPassword`: the admin never learns the new
 * password, because they only hand over a token the locked-out person redeems
 * themselves at `/reset-password`. Nothing stores the plaintext, so this
 * response is the only time it exists in readable form — the caller MUST show
 * it before discarding it (see `ResetTokenPanel`).
 */
export async function issueStaffResetToken(id: string): Promise<ResetTokenResult> {
  return apiFetch<ResetTokenResult>(`/staff/${id}/reset-token`, {
    method: 'POST',
  });
}

export interface InviteStaffInput {
  email: string;
  name?: string;
  phone?: string;
  role: StaffRole;
  accessExpiresAt?: string;
}

/**
 * Create a staff account with no password anyone knows, and get back a
 * one-time token — same shape as `ResetTokenResult`, reused directly by
 * `ResetTokenPanel` rather than a near-duplicate "invite panel". The primary
 * action the spec names for this page; `createStaff` above (an admin typing
 * a password on someone else's behalf) was previously the ONLY way in.
 */
export async function inviteStaff(input: InviteStaffInput): Promise<ResetTokenResult> {
  return apiFetch<ResetTokenResult>('/staff/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface TransferOwnershipResult {
  newOwner: StaffMember;
  self: StaffMember;
}

/**
 * Danger zone (B3.4). Promotes `targetId` to OWNER and steps the caller down
 * to MANAGER, atomically — the one deliberate exception to "nobody changes
 * their own role" (see `staff.service.ts`'s `transferOwnership` doc comment).
 * Requires the caller's current password, same proof-of-presence rule as
 * `changeOwnPassword`. Both accounts' sessions are revoked server-side, so
 * the caller's own token is dead the moment this resolves — the caller must
 * sign in again as their new role.
 */
export async function transferOwnership(
  targetId: string,
  currentPassword: string,
): Promise<TransferOwnershipResult> {
  return apiFetch<TransferOwnershipResult>(`/staff/${targetId}/transfer-ownership`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword }),
  });
}
