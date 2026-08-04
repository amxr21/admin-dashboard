'use client';

/**
 * Courier session storage — deliberately SEPARATE keys from
 * `auth-storage.ts` (staff). The two are different auth surfaces with
 * different token shapes (see `backend/src/services/courier-auth.service.ts`)
 * and must never be able to overwrite or be confused with one another, even
 * if a courier and a staff member share the same browser.
 */

const TOKEN_KEY = 'admin-dashboard:courier-token';
const COURIER_KEY = 'admin-dashboard:courier';

export interface CourierSession {
  id: string;
  name: string;
}

export function readCourierToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function readCourier(): CourierSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COURIER_KEY);
    return raw ? (JSON.parse(raw) as CourierSession) : null;
  } catch {
    return null;
  }
}

export function writeCourierSession(token: string, courier: CourierSession): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(COURIER_KEY, JSON.stringify(courier));
  } catch {
    // Storage full or blocked — the session still works for this tab.
  }
}

export function clearCourierSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(COURIER_KEY);
  } catch {
    // Nothing useful to do — the caller is signing out regardless.
  }
}
