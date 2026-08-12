/**
 * Unauthenticated auth calls.
 *
 * Sign-in itself lives in `hooks/useAuth.tsx`, because it has to seed session
 * state as a side effect. Password reset deliberately does NOT: redeeming a
 * token signs every existing session out (the backend bumps `tokenVersion`),
 * so there is no session to establish here — the user is sent to `/login` to
 * sign in fresh with the password they just chose. Keeping it out of the hook
 * keeps that "this does not log you in" property obvious.
 */

import { apiFetch } from '@/lib/api';

/**
 * Redeem a one-time reset token issued by an admin.
 *
 * The backend answers unknown, used, and expired tokens with the SAME generic
 * error on purpose — telling them apart would be an enumeration oracle. So
 * callers must not try to explain *which* of those happened; render whatever
 * message comes back.
 */
export async function redeemPasswordReset(
  token: string,
  password: string,
): Promise<void> {
  await apiFetch<{ ok: boolean }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export interface UpdateProfileInput {
  name?: string;
  phone?: string;
}

/**
 * Self-service name/phone edit. NOT the same call as `updateStaff` from
 * staff-api.ts — that one needs the `staff` area grant, which SUPPORT/
 * FULFILLMENT/DEMO don't hold, so a non-admin had no way to fix their own
 * name without asking an OWNER. `PATCH /auth/me` needs only a session.
 */
export async function updateOwnProfile(input: UpdateProfileInput) {
  return apiFetch<{
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    role: string;
  }>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Self-service password change. Requires the CURRENT password — the one
 * password path in this app that does, since nothing else vouches for the
 * caller beyond an already-issued session token.
 *
 * Returns a FRESH token: the change revokes every existing session,
 * including the one that made this request, so the caller must seed the new
 * token immediately or their next request 401s despite just succeeding.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/auth/me/password', {
    method: 'PATCH',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * Every LIVE device this account is signed in on.
 *
 * Distinct from `tokenVersion`'s all-or-nothing "sign out everywhere": this
 * is the per-session model (`Session` table) that makes "sign out THAT
 * phone, not this laptop" possible for the first time.
 */
export async function fetchOwnSessions(): Promise<SessionSummary[]> {
  return apiFetch<SessionSummary[]>('/auth/me/sessions');
}

/** Sign out one device without touching any other. */
export async function revokeOwnSession(sessionId: string): Promise<void> {
  await apiFetch<void>(`/auth/me/sessions/${sessionId}`, { method: 'DELETE' });
}

/**
 * B1.7 — tells the server "I signed myself out," so it can revoke the
 * calling session and write an `auth.logout` audit event. Signing out is a
 * client-side certainty (the token is being dropped either way) — this call
 * is best-effort by design at the CALL SITE (`useAuth.tsx`'s `signOut`),
 * never awaited there, so a network blip can't strand someone on the login
 * screen mid-signout.
 */
export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}
