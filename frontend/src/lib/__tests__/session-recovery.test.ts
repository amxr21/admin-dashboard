import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readBranchId, readToken, readUser, writeBranchId, writeSession } from '@/lib/auth-storage';
import {
  handleSessionExpired,
  resetSessionRecovery,
  SESSION_EXPIRED_EVENT,
  takeSessionReturnPath,
} from '@/lib/session-recovery';

describe('session-expiry recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/en/admin/orders?status=PENDING');
    resetSessionRecovery();
  });

  it('clears auth once and preserves a safe locale-neutral return path', () => {
    writeSession('expired-token', { id: 'user-1', email: 'admin@example.test', name: 'Admin', role: 'OWNER' });
    writeBranchId('branch-1');
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    handleSessionExpired();
    handleSessionExpired();

    expect(readToken()).toBeNull();
    expect(readUser()).toBeNull();
    expect(readBranchId()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeSessionReturnPath()).toBe('/admin/orders?status=PENDING');
    expect(takeSessionReturnPath()).toBeNull();
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });
});
