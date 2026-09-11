'use client';

import { clearSession } from '@/lib/auth-storage';

export const SESSION_EXPIRED_EVENT = 'admin-dashboard:session-expired';

const RETURN_PATH_KEY = 'admin-dashboard:session-return-path';
let expiryHandled = false;

function currentInternalPath(): string | null {
  if (typeof window === 'undefined') return null;
  const path = `${window.location.pathname}${window.location.search}`;
  const withoutLocale = path.replace(/^\/(?:en|ar)(?=\/)/, '');
  return withoutLocale.startsWith('/admin') && !withoutLocale.startsWith('/admin/login')
    ? withoutLocale
    : null;
}

export function handleSessionExpired(): void {
  if (typeof window === 'undefined' || expiryHandled) return;
  expiryHandled = true;

  const returnPath = currentInternalPath();
  try {
    if (returnPath) window.sessionStorage.setItem(RETURN_PATH_KEY, returnPath);
  } catch {
    // Recovery still signs out safely when sessionStorage is unavailable.
  }

  clearSession();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function takeSessionReturnPath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(RETURN_PATH_KEY);
    window.sessionStorage.removeItem(RETURN_PATH_KEY);
    return value?.startsWith('/admin') && !value.startsWith('//') ? value : null;
  } catch {
    return null;
  }
}

export function hasPendingSessionRecovery(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(RETURN_PATH_KEY) !== null;
  } catch {
    return false;
  }
}

export function resetSessionRecovery(): void {
  expiryHandled = false;
}
