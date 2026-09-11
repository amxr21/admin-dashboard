import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bulkSetStaffActive } from '../staff-api';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  apiFetch,
}));

beforeEach(() => apiFetch.mockReset());

describe('bulk staff lifecycle updates', () => {
  it('keeps successful changes when a later account is refused', async () => {
    apiFetch
      .mockResolvedValueOnce({ staff: { id: 's1' } })
      .mockRejectedValueOnce(new Error('Last owner cannot be deactivated'))
      .mockResolvedValueOnce({ staff: { id: 's3' } });

    await expect(bulkSetStaffActive(['s1', 's2', 's3'], false)).resolves.toEqual({
      succeeded: ['s1', 's3'],
      failed: [{ id: 's2', message: 'Last owner cannot be deactivated' }],
    });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/staff/s1', expect.any(Object));
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/staff/s2', expect.any(Object));
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/staff/s3', expect.any(Object));
  });
});
