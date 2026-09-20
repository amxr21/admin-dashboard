import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('../db/prisma.js', () => ({
  prisma: { branch: { findFirst } },
}));

import { resolveEffectiveTimezone } from '../middleware/branch-timezone.js';

describe('effective branch timezone', () => {
  beforeEach(() => findFirst.mockReset());

  it('uses the branch override before the business timezone', async () => {
    findFirst.mockResolvedValue({ timezone: 'Asia/Muscat', business: { timezone: 'Asia/Dubai' } });
    await expect(resolveEffectiveTimezone('branch-1')).resolves.toBe('Asia/Muscat');
  });

  it('falls back to the business timezone', async () => {
    findFirst.mockResolvedValue({ timezone: null, business: { timezone: 'Asia/Dubai' } });
    await expect(resolveEffectiveTimezone('branch-1')).resolves.toBe('Asia/Dubai');
  });

  it('uses UTC when neither level declares a timezone', async () => {
    findFirst.mockResolvedValue({ timezone: null, business: { timezone: null } });
    await expect(resolveEffectiveTimezone('branch-1')).resolves.toBe('UTC');
  });

  it('uses UTC without querying a branch for an all-business view', async () => {
    await expect(resolveEffectiveTimezone(null)).resolves.toBe('UTC');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('does not guess when a branch id is unknown', async () => {
    findFirst.mockResolvedValue(null);
    await expect(resolveEffectiveTimezone('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
