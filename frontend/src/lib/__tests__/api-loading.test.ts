import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/lib/api';
import { getLoadingActivitySnapshot } from '@/lib/loading-activity';
import { writeSession } from '@/lib/auth-storage';
import { resetSessionRecovery, SESSION_EXPIRED_EVENT } from '@/lib/session-recovery';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSessionRecovery();
});

describe('api loading feedback', () => {
  it('tracks mutations until their response is fully handled', async () => {
    let respond: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));

    const request = apiFetch<{ saved: boolean }>('/example', { method: 'POST', body: '{}' });
    expect(getLoadingActivitySnapshot()).toBe(1);

    respond?.(new Response(JSON.stringify({ data: { saved: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(request).resolves.toEqual({ saved: true });
    expect(getLoadingActivitySnapshot()).toBe(0);
  });

  it('leaves page-level GET loading to the page unless explicitly requested', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const request = apiFetch<[]>('/example');
    expect(getLoadingActivitySnapshot()).toBe(0);
    await request;
  });

  it('signals expiry only when a rejected request carried a session token', async () => {
    writeSession('expired-token', { id: 'user-1', email: 'admin@example.test', name: null, role: 'OWNER' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(apiFetch('/orders')).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('admin-dashboard:token')).toBeNull();
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });
});
