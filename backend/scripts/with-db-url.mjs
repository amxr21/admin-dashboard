#!/usr/bin/env node
/**
 * Runs a command with DATABASE_URL resolved from APP_MODE.
 *
 * Why this exists:
 * The Prisma CLI never runs application code, so `src/config/env.ts` — and
 * every guard in `src/config/app-mode.ts` — is invisible to it. It reads
 * `process.env.DATABASE_URL` (via dotenv on backend/.env) and nothing else.
 * That means the app could be correctly pointed at the local database by
 * APP_MODE while `prisma migrate dev` quietly reset the SHARED one, which is
 * the single most destructive version of this mistake and has nearly happened
 * on this project twice (see CLAUDE.md, `.claude-workbook/errors-log.md`).
 *
 * So every db:* script routes through here. It resolves the same way the app
 * does, applies the same refusals, prints the target it is about to touch, and
 * only then execs Prisma.
 *
 * Usage:  node scripts/with-db-url.mjs prisma migrate dev
 *         node scripts/with-db-url.mjs tsx prisma/seed.ts
 *
 * Both work when run by hand — `node_modules/.bin` is put on the child's PATH
 * below, so `prisma`/`tsx` resolve without pnpm having set that up first.
 *
 * Written as .mjs rather than .ts on purpose: it must run BEFORE anything is
 * compiled or generated (`db:generate` is itself one of its callers), so it
 * cannot depend on tsx, on the TypeScript build, or on @prisma/client
 * existing. It imports nothing but node builtins and dotenv.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, delimiter, resolve } from 'node:path';
import { config } from 'dotenv';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Same file the app loads. Not `override: true` — a variable already set in
// the real environment (CI, a Coolify service) must win over the local file.
config({ path: resolve(backendDir, '.env') });

const APP_MODES = ['local', 'dev', 'prod'];
const DEFAULT_MODE = 'local';

function fail(message) {
  process.stderr.write(`\n[with-db-url] ${message}\n\n`);
  process.exit(1);
}

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

const rawMode = process.env.APP_MODE?.trim().toLowerCase();

if (rawMode && !APP_MODES.includes(rawMode)) {
  fail(
    `APP_MODE is "${rawMode}", which is not a valid mode. ` +
      `Expected one of: ${APP_MODES.join(', ')}. Leave it unset for "${DEFAULT_MODE}".`,
  );
}

const mode = rawMode || DEFAULT_MODE;
const suffix = mode.toUpperCase();

const url =
  process.env[`DATABASE_URL_${suffix}`]?.trim() || process.env.DATABASE_URL?.trim();

if (!url) {
  fail(
    `No database URL is configured for APP_MODE="${mode}". ` +
      `Set DATABASE_URL_${suffix} (preferred) or DATABASE_URL in backend/.env.`,
  );
}

// Mirrors src/config/app-mode.ts. Duplicated rather than imported because
// this script has to run before any TypeScript is compiled — the two must be
// kept in sync by hand, which is why both carry this note.
let host;
try {
  host = new URL(url).hostname || undefined;
} catch {
  host = undefined;
}

if (host) {
  const loopback = isLoopbackHost(host);

  if (mode === 'local' && !loopback) {
    fail(
      `APP_MODE="local" but the database URL points at a remote host ("${host}").\n` +
        `Refusing to run: \`migrate dev\` and \`db push\` can RESET the target database, ` +
        `and this one is shared.\nSet APP_MODE=dev (or prod) if you really mean to touch it.`,
    );
  }

  if (mode !== 'local' && loopback) {
    fail(
      `APP_MODE="${mode}" but the database URL points at a local host ("${host}").\n` +
        `Set DATABASE_URL_${suffix} to the real ${mode} database, or APP_MODE=local.`,
    );
  }
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  fail('No command given. Usage: node scripts/with-db-url.mjs prisma migrate dev');
}

// Print the target before running. A destructive Prisma prompt ("this will
// reset the database") is far easier to answer correctly when the database it
// means is named on screen a line above it. Credentials are never printed —
// only the mode, host and database name.
let label = host ?? 'unknown host';
try {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '');
  label = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/${database || '(none)'}`;
} catch {
  // Keep the host-only label.
}

process.stderr.write(`[with-db-url] APP_MODE=${mode} → ${label}\n`);

/**
 * `node_modules/.bin` is prepended so `prisma` and `tsx` resolve when this
 * script is invoked BY HAND (`node scripts/with-db-url.mjs tsx prisma/seed.ts`),
 * not just through pnpm.
 *
 * pnpm puts that directory on PATH for the scripts it runs, so the
 * package.json entries always worked — but a hand-run failed with
 * "'tsx' is not recognized", which reads like a missing dependency rather than
 * a PATH problem. Reported by a parallel session that hit exactly this.
 *
 * PATH is looked up case-insensitively on Windows (`Path`, `PATH`), so reuse
 * whatever key the environment already has rather than adding a second one —
 * two differently-cased PATH keys in the same env block is its own bug.
 */
const pathKey =
  Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';

const childEnv = {
  ...process.env,
  // Prisma reads DATABASE_URL from the environment; this is the whole point.
  DATABASE_URL: url,
  [pathKey]: [resolve(backendDir, 'node_modules/.bin'), process.env[pathKey]]
    .filter(Boolean)
    .join(delimiter),
};

const child = spawn(command, args, {
  cwd: backendDir,
  env: childEnv,
  stdio: 'inherit',
  // Prisma and tsx are .cmd shims on Windows, which execvp cannot run directly.
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  fail(`Failed to start "${command}": ${error.message}`);
});

child.on('exit', (code, signal) => {
  // Preserve the child's exit status so CI and pnpm still see failures.
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
