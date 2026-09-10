import { describe, expect, it } from 'vitest';

import { hashIdempotentRequest } from '../services/idempotency.service.js';

describe('idempotent request hashing', () => {
  it('ignores object insertion order at every level', () => {
    const left = { method: 'cash', nested: { quantity: 2, productId: 'p1' } };
    const right = { nested: { productId: 'p1', quantity: 2 }, method: 'cash' };

    expect(hashIdempotentRequest(left)).toBe(hashIdempotentRequest(right));
  });

  it('keeps array order significant', () => {
    expect(hashIdempotentRequest({ lines: ['p1', 'p2'] })).not.toBe(
      hashIdempotentRequest({ lines: ['p2', 'p1'] }),
    );
  });
});
