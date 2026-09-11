#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationRunner = resolve(backendDir, 'scripts/with-db-url.mjs');

/**
 * Apply every committed migration before the HTTP process starts.
 *
 * The deployment used to rely on a command configured only in Coolify. A
 * container could therefore start against an older schema when that setting
 * was absent or changed, and the first feature query failed as a generic 500.
 * Keeping the ordering here makes it part of the versioned application
 * contract: migration failure means this new container never becomes ready.
 */
export function runMigrations() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [migrationRunner, 'prisma', 'migrate', 'deploy'],
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

export async function runProductionStart({
  migrate = runMigrations,
  startServer = () => import('../dist/server.js'),
} = {}) {
  const migrationExitCode = await migrate();
  if (migrationExitCode !== 0) return migrationExitCode;

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
