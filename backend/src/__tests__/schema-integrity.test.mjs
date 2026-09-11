import { describe, expect, it, vi } from 'vitest';

import {
  checkSchemaIntegrity,
  requireSafeShadowDatabaseUrl,
} from '../../scripts/check-schema-integrity.mjs';

describe('migration/schema integrity gate', () => {
  it('accepts only a disposable loopback MySQL test database', () => {
    expect(
      requireSafeShadowDatabaseUrl('mysql://root:test@127.0.0.1:3306/admin_dashboard_test'),
    ).toBe('mysql://root:test@127.0.0.1:3306/admin_dashboard_test');
    expect(() =>
      requireSafeShadowDatabaseUrl('mysql://root:secret@database.internal:3306/admin_dashboard_test'),
    ).toThrow(/loopback MySQL database/);
    expect(() =>
      requireSafeShadowDatabaseUrl('mysql://root:secret@127.0.0.1:3306/admin_dashboard'),
    ).toThrow(/name contains "test"/);
  });

  it('requires an explicit shadow database URL', () => {
    expect(() => requireSafeShadowDatabaseUrl()).toThrow(
      'SCHEMA_CHECK_SHADOW_DATABASE_URL is required',
    );
  });

  it.each([
    ['malformed URL', 'not a url'],
    ['non-MySQL URL', 'postgresql://root:test@localhost:5432/schema_test'],
    ['remote URL', 'mysql://root:test@database.internal:3306/schema_test'],
    ['non-test database', 'mysql://root:test@localhost:3306/admin_dashboard'],
  ])('rejects a %s before starting Prisma', async (_caseName, shadowDatabaseUrl) => {
    const runDiff = vi.fn();

    await expect(checkSchemaIntegrity({ shadowDatabaseUrl, runDiff })).rejects.toThrow();
    expect(runDiff).not.toHaveBeenCalled();
  });

  it('passes when committed migrations and schema are identical', async () => {
    const runDiff = vi.fn(async () => 0);

    await expect(
      checkSchemaIntegrity({
        shadowDatabaseUrl: 'mysql://root:test@localhost:3306/schema_test',
        runDiff,
      }),
    ).resolves.toBeUndefined();
    expect(runDiff).toHaveBeenCalledOnce();
  });

  it('fails with an actionable message when a migration is missing', async () => {
    await expect(
      checkSchemaIntegrity({
        shadowDatabaseUrl: 'mysql://root:test@localhost:3306/schema_test',
        runDiff: async () => 2,
      }),
    ).rejects.toThrow(/commit the missing migration/);
  });

  it('does not hide comparison process failures', async () => {
    const failure = new Error('could not start Prisma');

    await expect(
      checkSchemaIntegrity({
        shadowDatabaseUrl: 'mysql://root:test@localhost:3306/schema_test',
        runDiff: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});
