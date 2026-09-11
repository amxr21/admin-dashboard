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
  | 'CASHIER'
  | 'SUPPORT'
  | 'DEMO';

/** Highest privilege first. Mirrors ROLE_ORDER in backend config/roles.ts. */
export const STAFF_ROLES: StaffRole[] = [
  'DEVELOPER',
  'OWNER',
  'MANAGER',
  'FULFILLMENT',
  'SUPPORT',
  // Below SUPPORT so a cashier outranks nobody — mirrors ROLE_ORDER in
  // backend config/roles.ts, which is the authority. Drift here would let the
  // UI offer a role change the API then refuses.
  'CASHIER',
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
  /**
   * Last ACTIVITY across live sessions — distinct from `lastLoginAt`, which is
   * when they last signed IN (F2.5).
   *
   * Someone who signed in on Monday and has been working ever since has an old
   * `lastLoginAt` and a recent `lastSeenAt`; someone who signed in an hour ago
   * and closed the tab has the reverse. "Who is actually using this dashboard"
   * is the second question, and it was previously unanswerable.
   *
   * Null when no live session exists — signed out everywhere, or never used it.
   */
  lastSeenAt: string | null;
  /**
   * Failed sign-in attempts against this email in the last 24h (F2.4).
   *
   * A SIGNAL, not an enforcement — the app already has its own lockout
   * (`lockedUntil` below), and a second differently-triggered one would be a
   * footgun. A non-zero count here does not mean the account is locked.
   */
  recentFailedLogins: number;
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

export interface BulkStaffLifecycleResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

/**
 * Apply lifecycle changes one at a time so each account keeps the backend's
 * rank, self-deactivation, and last-owner safeguards. Sequential execution is
 * intentional: parallel last-owner checks could all pass against the same
 * stale owner count. One refusal does not discard the successful rows.
 */
export async function bulkSetStaffActive(
  ids: readonly string[],
  isActive: boolean,
): Promise<BulkStaffLifecycleResult> {
  const result: BulkStaffLifecycleResult = { succeeded: [], failed: [] };

  for (const id of ids) {
    try {
      await updateStaff(id, { isActive });
      result.succeeded.push(id);
    } catch (caught) {
      result.failed.push({
        id,
        message: caught instanceof Error ? caught.message : 'Unknown error',
      });
    }
  }

  return result;
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

/* ── Sessions & sign-in history (F2) ─────────────────────────────────── */

export interface StaffSession {
  id: string;
  /** Free text from the User-Agent header. Attacker-controlled, so it is only
   *  ever DISPLAYED, never parsed for a decision. */
  userAgent: string | null;
  /** Null where there is no trustworthy answer — never a guess. */
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** Live sessions for another user. Rank-checked server-side: nobody reaches
 *  upward, exactly as with any other staff write. */
export async function fetchStaffSessions(id: string): Promise<StaffSession[]> {
  return apiFetch<StaffSession[]>(`/staff/${id}/sessions`);
}

export interface LoginHistoryParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  /** `DENIED` narrows to failures — the security-review query. */
  outcome?: 'SUCCESS' | 'DENIED';
}

export interface LoginHistoryEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  outcome: 'SUCCESS' | 'DENIED';
  /** On a FAILED attempt this carries the attempted email and the reason —
   *  a failure has not proved who anyone is, so `actorEmail` is null there
   *  and this is the only identifying fact available. */
  changes: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface LoginHistoryResult {
  entries: LoginHistoryEntry[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

function historyQuery(params: LoginHistoryParams): string {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.outcome) search.set('outcome', params.outcome);
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Store-wide sign-in history — who got in, who did not, from where.
 *
 * Read entirely from audit rows that already existed; this adds no new write
 * path, so it cannot drift from the trail it reports.
 */
export async function fetchLoginHistory(
  params: LoginHistoryParams = {},
): Promise<LoginHistoryResult> {
  return apiFetch<LoginHistoryResult>(`/login-history${historyQuery(params)}`);
}

/** One person's history. Includes their FAILED attempts, which carry no
 *  actor id and are matched by the attempted email instead. */
export async function fetchStaffLoginHistory(
  id: string,
  params: LoginHistoryParams = {},
): Promise<LoginHistoryResult> {
  return apiFetch<LoginHistoryResult>(`/staff/${id}/login-history${historyQuery(params)}`);
}

/** Kill one device. */
export async function revokeStaffSession(id: string, sessionId: string): Promise<void> {
  await apiFetch<void>(`/staff/${id}/sessions/${sessionId}`, { method: 'DELETE' });
}

/** Kill every device AND invalidate already-issued tokens (the server bumps
 *  `tokenVersion`); revoking session rows alone would leave live JWTs working
 *  until they expired. */
export async function signOutStaffEverywhere(id: string): Promise<void> {
  await apiFetch<void>(`/staff/${id}/sign-out-everywhere`, { method: 'POST' });
}
