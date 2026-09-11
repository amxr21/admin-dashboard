import { describe, expect, it, vi } from 'vitest';

import { runProductionStart } from '../../scripts/start-production.mjs';

describe('production startup migration gate', () => {
  it('applies migrations before starting the HTTP server', async () => {
    const order = [];
    const migrate = vi.fn(async () => {
      order.push('migrate');
      return 0;
    });
    const startServer = vi.fn(async () => {
      order.push('serve');
    });

    await expect(runProductionStart({ migrate, startServer })).resolves.toBe(0);
    expect(order).toEqual(['migrate', 'serve']);
  });

  it('does not serve traffic when migration deployment fails', async () => {
    const startServer = vi.fn();

    await expect(
      runProductionStart({ migrate: async () => 17, startServer }),
    ).resolves.toBe(17);
    expect(startServer).not.toHaveBeenCalled();
  });

  it('does not hide a migration runner failure', async () => {
    const failure = new Error('migration runner unavailable');
    const startServer = vi.fn();

    await expect(
      runProductionStart({
        migrate: async () => {
          throw failure;
        },
        startServer,
      }),
    ).rejects.toBe(failure);
    expect(startServer).not.toHaveBeenCalled();
  });
});
