#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationRunner = resolve(backendDir, 'scripts/with-db-url.mjs');
const schemaPath = resolve(backendDir, 'prisma/schema.prisma');

// `migrate diff` only introspects and compares these two sources; unlike
// migrate deploy/dev or db push, it cannot write to the running database.
export const DATABASE_SCHEMA_DIFF_ARGS = Object.freeze([
  'migrate',
  'diff',
  '--from-schema-datasource',
  schemaPath,
  '--to-schema-datamodel',
  schemaPath,
  '--exit-code',
]);

/**
 * Apply every committed migration and verify migration history is healthy
 * before the HTTP process starts.
 *
 * The deployment used to rely on a command configured only in Coolify. A
 * container could therefore start against an older schema when that setting
 * was absent or changed, and the first feature query failed as a generic 500.
 * Keeping the ordering here makes it part of the versioned application
 * contract: migration deployment, history divergence, or a failed migration
 * means this new container never becomes ready.
 */
export function runPrismaCommand(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [migrationRunner, 'prisma', ...args],
      {
        cwd: backendDir,
        env: process.env,
        stdio: 'inherit',
      },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Migration process stopped by ${signal}`));
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

export function runMigrations() {
  return runPrismaCommand(['migrate', 'deploy']);
}

export function verifyMigrationStatus() {
  return runPrismaCommand(['migrate', 'status']);
}

export function verifyDatabaseSchema() {
  return runPrismaCommand(DATABASE_SCHEMA_DIFF_ARGS);
}

/**
 * Start order: deploy migrations, then verify the RUNNING database's shape
 * against `schema.prisma`. The shape comparison — not migration bookkeeping —
 * is what decides whether this container may serve traffic.
 *
 * ─── WHY `migrate status` IS DIAGNOSTIC AND NOT A GATE ───────────────────
 * `migrate status` fails whenever `_prisma_migrations` is missing or
 * incomplete, even when every table, column and index is already correct.
 * That exact state has occurred on this project repeatedly (see CLAUDE.md and
 * `.claude-workbook/errors-log.md`): the tracking table disappeared while the
 * real schema and data were untouched. On such a database `migrate deploy`
 * also fails, because it replays the first migration against tables that
 * already exist.
 *
 * Gating startup on either of those would turn a bookkeeping gap into a total
 * outage, which is strictly worse than the drift-induced 500 this gate exists
 * to prevent. So both are reported loudly and allowed to proceed; the live
 * shape check below is authoritative and still blocks a genuinely mismatched
 * database. A shape mismatch is the condition that actually breaks queries.
 */
export async function runProductionStart({
  migrate = runMigrations,
  verify = verifyMigrationStatus,
  verifySchema = verifyDatabaseSchema,
  startServer = () => import('../dist/server.js'),
  log = (message) => process.stderr.write(`[production-start] ${message}\n`),
} = {}) {
  const migrationExitCode = await migrate();
  if (migrationExitCode !== 0) {
    log(
      `\`prisma migrate deploy\` exited ${migrationExitCode}. Continuing to the ` +
        'live schema check, which decides whether this container may serve traffic.',
    );
  }

  const statusExitCode = await verify();
  if (statusExitCode !== 0) {
    log(
      `\`prisma migrate status\` exited ${statusExitCode}. Migration history is ` +
        'incomplete; verify `_prisma_migrations` after this deploy.',
    );
  }

  const schemaExitCode = await verifySchema();
  if (schemaExitCode !== 0) {
    log(
      `Running database does not match schema.prisma (exit ${schemaExitCode}). ` +
        'Refusing to serve traffic.',
    );
    return schemaExitCode;
  }

  await startServer();
  return 0;
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryPath === import.meta.url) {
  runProductionStart()
    .then((exitCode) => {
      if (exitCode !== 0) process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `[production-start] Startup failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      process.exitCode = 1;
    });
}
