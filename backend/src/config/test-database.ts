import { assertDatabaseHost } from './app-mode.js';

/** Integration tests must never share the app's database, even on localhost. */
export function resolveTestDatabaseUrl(raw: Record<string, string | undefined>): string {
  const connection = raw.TEST_DATABASE_URL?.trim()
    || raw.DATABASE_URL_LOCAL?.trim()
    || raw.DATABASE_URL?.trim()
    || 'mysql://root:test@127.0.0.1:3306/admin_dashboard_test';
  let parsed: URL;
  try {
    parsed = new URL(connection);
  } catch {
    throw new Error('Invalid test database URL. Set TEST_DATABASE_URL to a dedicated local MySQL test database.');
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== 'mysql:' || !parsed.hostname || !/^(?:test_[a-z0-9_]+|[a-z0-9_]+_test)$/i.test(database)) {
    throw new Error(
      'Refusing to run tests against an application database. Set TEST_DATABASE_URL to a dedicated local MySQL database named test_* or *_test.',
    );
  }
  assertDatabaseHost('local', connection);
  return connection;
}
