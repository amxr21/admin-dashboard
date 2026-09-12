import { describe, expect, it, vi } from 'vitest';

import {
  DATABASE_SCHEMA_DIFF_ARGS,
  runProductionStart,
} from '../../scripts/start-production.mjs';

describe('production startup migration gate', () => {
  it('uses a read-only database-to-datamodel diff for live schema parity', () => {
    expect(DATABASE_SCHEMA_DIFF_ARGS).toEqual([
      'migrate',
      'diff',
      '--from-schema-datasource',
      expect.stringMatching(/prisma[\\/]schema\.prisma$/),
      '--to-schema-datamodel',
      expect.stringMatching(/prisma[\\/]schema\.prisma$/),
      '--exit-code',
    ]);
    expect(DATABASE_SCHEMA_DIFF_ARGS).not.toContain('deploy');
    expect(DATABASE_SCHEMA_DIFF_ARGS).not.toContain('dev');
    expect(DATABASE_SCHEMA_DIFF_ARGS).not.toContain('push');
  });

  it('applies migrations before starting the HTTP server', async () => {
    const order = [];
    const migrate = vi.fn(async () => {
      order.push('migrate');
      return 0;
    });
    const startServer = vi.fn(async () => {
      order.push('serve');
    });
    const verify = vi.fn(async () => {
      order.push('status');
      return 0;
    });
    const verifySchema = vi.fn(async () => {
      order.push('schema');
      return 0;
    });

    await expect(
      runProductionStart({ migrate, verify, verifySchema, startServer }),
    ).resolves.toBe(0);
    expect(order).toEqual(['migrate', 'status', 'schema', 'serve']);
  });

  // A database can hold the correct tables while `_prisma_migrations` is
  // missing or incomplete — a state this project has hit repeatedly. Both
  // `migrate deploy` and `migrate status` fail there, so gating on either
  // would turn a bookkeeping gap into an outage. The live shape check decides.
  it('still serves traffic when migration deployment fails but the live schema matches', async () => {
    const startServer = vi.fn();
    const log = vi.fn();

    await expect(
      runProductionStart({
        migrate: async () => 17,
        verify: async () => 0,
        verifySchema: async () => 0,
        startServer,
        log,
      }),
    ).resolves.toBe(0);
    expect(startServer).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('migrate deploy'));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('MIGRATION_DATA_REVIEW_REQUIRED'),
    );
  });

  it('still serves traffic when migration status is unhealthy but the live schema matches', async () => {
    const startServer = vi.fn();
    const log = vi.fn();

    await expect(
      runProductionStart({
        migrate: async () => 0,
        verify: async () => 19,
        verifySchema: async () => 0,
        startServer,
        log,
      }),
    ).resolves.toBe(0);
    expect(startServer).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('migrate status'));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('MIGRATION_DATA_REVIEW_REQUIRED'),
    );
  });

  it('checks the live schema even after both migration commands fail', async () => {
    const startServer = vi.fn();
    const verifySchema = vi.fn(async () => 2);

    await expect(
      runProductionStart({
        migrate: async () => 17,
        verify: async () => 19,
        verifySchema,
        startServer,
        log: vi.fn(),
      }),
    ).resolves.toBe(2);
    expect(verifySchema).toHaveBeenCalledOnce();
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
        verify: vi.fn(),
        verifySchema: vi.fn(),
        startServer,
      }),
    ).rejects.toBe(failure);
    expect(startServer).not.toHaveBeenCalled();
  });

  // A crashed runner is not evidence the schema is healthy, so a thrown error
  // still aborts startup — distinct from a non-zero exit code, which is not.
  it('does not hide a post-deploy status-check failure', async () => {
    const failure = new Error('migration status unavailable');
    const startServer = vi.fn();

    await expect(
      runProductionStart({
        migrate: async () => 0,
        verify: async () => {
          throw failure;
        },
        verifySchema: vi.fn(),
        startServer,
      }),
    ).rejects.toBe(failure);
    expect(startServer).not.toHaveBeenCalled();
  });

  it('does not serve traffic when the running schema differs from the application schema', async () => {
    const startServer = vi.fn();

    await expect(
      runProductionStart({
        migrate: async () => 0,
        verify: async () => 0,
        verifySchema: async () => 2,
        startServer,
      }),
    ).resolves.toBe(2);
    expect(startServer).not.toHaveBeenCalled();
  });
});
