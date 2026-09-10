import { describe, expect, it } from 'vitest';
import { resolveTestDatabaseUrl } from '../config/test-database.js';

const url = (database: string, host = '127.0.0.1') => `mysql://test:test@${host}:3306/${database}`;

describe('test database isolation', () => {
  it.each(['default', 'defaultdb', 'admin_dashboard', 'test', 'admin_test_backup'])('refuses application database %s', (database) => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL_LOCAL: url(database) })).toThrow(/dedicated local MySQL/);
  });

  it.each(['admin_dashboard_test', 'test_admin_dashboard'])('accepts explicitly named test database %s', (database) => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: url(database) })).toBe(url(database));
  });

  it('prefers the explicit test URL over the app environment', () => {
    expect(resolveTestDatabaseUrl({
      TEST_DATABASE_URL: url('isolated_test'),
      DATABASE_URL_LOCAL: url('admin_dashboard'),
      DATABASE_URL: url('default', 'production.example.test'),
    })).toBe(url('isolated_test'));
  });

  it('refuses remote test databases', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: url('admin_test', 'production.example.test') })).toThrow(/remote host/);
  });

  it('does not expose credentials in malformed URL errors', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'secret-credential' })).toThrow(/^Invalid test database URL\./);
  });

  it('has an isolated default for a clean environment', () => {
    expect(resolveTestDatabaseUrl({})).toBe('mysql://root:test@127.0.0.1:3306/admin_dashboard_test');
  });
});
