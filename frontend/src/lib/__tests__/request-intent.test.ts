import { describe, expect, it, vi } from 'vitest';

import { requestIntentFor } from '@/lib/request-intent';

describe('requestIntentFor', () => {
  it('reuses the key while a failed request payload is unchanged', () => {
    const createKey = vi.fn(() => 'intent-1');
    const payload = { lines: [{ productId: 'p1', quantity: 1 }], method: 'cash' };

    const first = requestIntentFor(payload, null, createKey);
    const retry = requestIntentFor(payload, first, createKey);

    expect(retry).toBe(first);
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it('creates a new key when the user changes the request', () => {
    const createKey = vi
      .fn<() => string>()
      .mockReturnValueOnce('intent-1')
      .mockReturnValueOnce('intent-2');
    const first = requestIntentFor({ quantity: 1 }, null, createKey);

    const changed = requestIntentFor({ quantity: 2 }, first, createKey);

    expect(changed.key).toBe('intent-2');
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });
});
