#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = resolve(backendDir, 'prisma/migrations');
const schemaPath = resolve(backendDir, 'prisma/schema.prisma');

function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost')
  );
}

/**
 * `prisma migrate diff --from-migrations` needs a shadow database and resets
 * it while replaying migration history. This check must never be pointed at a
 * shared or production database, even by a mistaken CI/environment setting.
 */
export function requireSafeShadowDatabaseUrl(rawUrl) {
  if (!rawUrl?.trim()) {
    throw new Error('SCHEMA_CHECK_SHADOW_DATABASE_URL is required');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('SCHEMA_CHECK_SHADOW_DATABASE_URL must be a valid MySQL URL');
  }

  const database = parsed.pathname.replace(/^\//, '').toLowerCase();
  if (parsed.protocol !== 'mysql:' || !isLoopbackHost(parsed.hostname) || !database.includes('test')) {
    throw new Error(
      'Schema integrity checks require a loopback MySQL database whose name contains "test"',
    );
  }

  return rawUrl;
}

export function runMigrationDiff(shadowDatabaseUrl) {
  return new Promise((resolvePromise, reject) => {
    const pathKey =
      Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    const child = spawn(
      'prisma',
      [
        'migrate',
        'diff',
        '--from-migrations',
        migrationsDir,
        '--to-schema-datamodel',
        schemaPath,
        '--shadow-database-url',
        shadowDatabaseUrl,
        '--exit-code',
      ],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          [pathKey]: [resolve(backendDir, 'node_modules/.bin'), process.env[pathKey]]
            .filter(Boolean)
            .join(delimiter),
        },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Schema integrity process stopped by ${signal}`));
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

export async function checkSchemaIntegrity({
  shadowDatabaseUrl = process.env.SCHEMA_CHECK_SHADOW_DATABASE_URL,
  runDiff = runMigrationDiff,
} = {}) {
  const safeUrl = requireSafeShadowDatabaseUrl(shadowDatabaseUrl);
  const exitCode = await runDiff(safeUrl);

  if (exitCode === 2) {
    throw new Error(
      'Prisma schema differs from the result of committed migrations; commit the missing migration',
    );
  }
  if (exitCode !== 0) {
    throw new Error(`Prisma migration/schema comparison failed with exit code ${exitCode}`);
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (entryPath === import.meta.url) {
  checkSchemaIntegrity().catch((error) => {
    process.stderr.write(
      `[schema-integrity] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
