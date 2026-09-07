'use client';

import type { StaffRole } from '@/config/areas';

/**
 * Client-side session storage.
 *
 * ─── WHY localStorage, AND WHAT IT COSTS ─────────────────────────────
 * The backend returns a JWT in the response body (see auth.service.ts), so it
 * has to live somewhere the client can read to attach the Authorization
 * header. localStorage is the only option that survives a refresh given that
 * design.
 *
 * The trade-off is real and should not be glossed: a token in localStorage is
 * readable by any script on the page, so an XSS bug becomes full account
 * takeover. An httpOnly cookie would not be — but that requires the backend to
 * SET the cookie and the frontend to send credentials, which is a backend
 * change, not a frontend one.
 *
 * Recorded in PROJECT_STATUS.md alongside token revocation, which is the
 * related gap: today a stolen token stays valid until it expires.
 *
 * Mitigations already in place: React escapes by default, CSP is set by
 * helmet on the API, and no `dangerouslySetInnerHTML` exists in the codebase.
 */

const TOKEN_KEY = 'admin-dashboard:token';
const USER_KEY = 'admin-dashboard:user';
/**
 * The active branch (F8.5).
 *
 * Per-browser, like the sidebar collapse state and unlike anything in the
 * settings registry: "which shop am I standing in" is a property of this
 * person at this machine, not of the organisation. Storing it server-side
 * would mean opening a second tab to check another branch changed the first.
 *
 * It is NOT a credential and grants nothing on its own — the server resolves
 * what the header allows (see `withBranchContext`), so a tampered value can
 * only ever narrow access or be ignored.
 */
const BRANCH_KEY = 'admin-dashboard:branch';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
}

/** Reads the token, or null when absent or unreadable. */
export function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // localStorage throws in private mode on some browsers, and when storage
    // is full. A sign-in page that crashes is worse than one that treats the
    // user as signed out.
    return null;
  }
}

/**
 * Cached user, so the shell can render immediately on load instead of showing
 * a spinner while /auth/me resolves.
 *
 * NEVER trust this for authorisation. It is a rendering hint — the user could
 * edit it in devtools to claim OWNER, and the API would still refuse every
 * request their real role disallows.
 */
export function readUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    // Corrupted JSON should sign the user out, not crash the app.
    return null;
  }
}

export function writeSession(token: string, user: SessionUser): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Storage full or blocked. The session still works for this tab; it just
    // won't survive a refresh. Better than blocking sign-in.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    // The branch goes too: the next person to sign in on this machine must
    // not inherit where the last one was working.
    window.localStorage.removeItem(BRANCH_KEY);
  } catch {
    // Nothing useful to do — the caller is signing out regardless.
  }
}

/** The active branch id, or null for "all branches". */
export function readBranchId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(BRANCH_KEY);
    return value && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

/** Passing null clears it, which means "all branches" — a real choice. */
export function writeBranchId(branchId: string | null): void {
  try {
    if (branchId) window.localStorage.setItem(BRANCH_KEY, branchId);
    else window.localStorage.removeItem(BRANCH_KEY);
  } catch {
    // Same reasoning as writeSession: the choice still applies to this tab.
  }
}
