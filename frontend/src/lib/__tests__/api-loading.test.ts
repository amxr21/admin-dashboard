import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/lib/api';
import { getLoadingActivitySnapshot } from '@/lib/loading-activity';

afterEach(() => {
  vi.unstubAllGlobals();
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
});
