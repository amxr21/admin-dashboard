/**
 * Resolves which environment this backend process is pointed AT.
 *
 * Why this file exists:
 * The frontend already had `src/lib/api-config.ts` — an explicit
 * `NEXT_PUBLIC_APP_MODE` that selects between per-mode API URLs with no
 * fallback. The backend had no equivalent. `backend/.env` carried ONE
 * `DATABASE_URL` with the other candidates sitting commented out above it, so
 * switching between the local MySQL and the shared Aiven database meant
 * hand-editing the file and moving a `#`. That is the same class of mistake
 * the frontend module was written to make impossible, and it has a worse blast
 * radius here: the wrong value doesn't break a page, it runs migrations and
 * writes rows against the wrong database. This project has already had two
 * near-misses of exactly that shape (see CLAUDE.md and
 * `.claude-workbook/errors-log.md`).
 *
 * The contract mirrors the frontend's deliberately — same mode names, same
 * "declare it, never infer it" rule, same both-directions guard:
 *
 *   local → DATABASE_URL_LOCAL / CORS_ORIGINS_LOCAL   (DB must be loopback)
 *   dev   → DATABASE_URL_DEV   / CORS_ORIGINS_DEV     (DB must NOT be loopback)
 *   prod  → DATABASE_URL_PROD  / CORS_ORIGINS_PROD    (DB must NOT be loopback)
 *
 * `APP_MODE` is a SEPARATE axis from `NODE_ENV`, which is why this is not
 * folded into it. `NODE_ENV` says how the process should BEHAVE (Sentry on,
 * logging level, error verbosity, Express's own optimisations); `APP_MODE`
 * says which environment's DATA it talks to. They come apart routinely and
 * legitimately: `NODE_ENV=production` with `APP_MODE=dev` is a production
 * BUILD being smoke-tested against the dev database, and `NODE_ENV=development
 * APP_MODE=prod` is a developer debugging a live-data issue on purpose.
 * Overloading one variable to mean both would make those two states
 * unexpressible.
 *
 * Only the two values that genuinely differ per target are mode-selected.
 * Secrets (JWT_SECRET, the HMAC keys) are deliberately single-valued: they
 * SHOULD differ per environment, but by living in each host's own env vars —
 * keeping three sets of production secrets in one developer's local file is a
 * bigger risk than the switching convenience is worth.
 */

/** The environments this backend can be pointed at. */
export type AppMode = 'local' | 'dev' | 'prod';

export const APP_MODES: readonly AppMode[] = ['local', 'dev', 'prod'];

/**
 * `local` is the default here, and that is the opposite of the frontend's
 * default (`dev`) ON PURPOSE — the risk is not symmetric.
 *
 * An unset mode on the frontend means a DEPLOYED bundle, where defaulting to
 * `local` would point every visitor's browser at their own machine. An unset
 * mode on the backend overwhelmingly means a developer's own `pnpm dev`, where
 * defaulting to `dev` would silently write to the SHARED database. Each side
 * defaults to its own least-destructive wrong answer. Anything actually
 * deployed sets the variable explicitly in Coolify.
 */
export const DEFAULT_MODE: AppMode = 'local';

/** Hosts that only ever resolve to the machine running this process. */
function isLoopbackHost(hostname: string): boolean {
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
 * Extracts the hostname from a database connection string.
 *
 * Returns `undefined` rather than throwing when the shape is unrecognised: a
 * malformed `DATABASE_URL` is Prisma's error to report with its own far better
 * message, and the guards below treat "host unknown" as "cannot judge" instead
 * of inventing a verdict. A socket-path connection (no host at all) lands here
 * too, which is correct — there is nothing to compare.
 */
export function databaseHost(url: string): string | undefined {
  try {
    // `mysql://` is a known scheme to WHATWG URL, so this handles credentials
    // containing escaped `@`/`:` correctly — which hand-rolled splitting does
    // not, and this project's own passwords contain `@`.
    const parsed = new URL(url);
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

export function readAppMode(raw: string | undefined): AppMode {
  const value = raw?.trim().toLowerCase();

  if (!value) return DEFAULT_MODE;

  if (!APP_MODES.includes(value as AppMode)) {
    throw new Error(
      `APP_MODE is "${value}", which is not a valid mode. ` +
        `Expected one of: ${APP_MODES.join(', ')}. ` +
        `Leave it unset to use the default ("${DEFAULT_MODE}").`,
    );
  }

  return value as AppMode;
}

/**
 * Picks the value for `mode` from a per-mode set, falling back to the
 * single-valued variable.
 *
 * The unsuffixed variable is an OVERRIDE, not a silent default: it is subject
 * to exactly the same guards as a per-mode value (see `assertDatabaseHost`).
 * It exists so an already-configured environment — CI's `DATABASE_URL`, a
 * Coolify service that sets one URL because it only ever has one — keeps
 * working without inventing a `_PROD` suffix it does not need. A
 * compatibility path that skipped the guards would reintroduce the bug under a
 * different variable name.
 */
export function selectForMode(
  mode: AppMode,
  perMode: Record<AppMode, string | undefined>,
  fallback: string | undefined,
): { value: string | undefined; source: string } {
  const suffixed = perMode[mode]?.trim();

  if (suffixed) {
    return { value: suffixed, source: `_${mode.toUpperCase()}` };
  }

  const plain = fallback?.trim();

  return { value: plain || undefined, source: plain ? 'unsuffixed' : 'unset' };
}

/**
 * Refuses a database host that contradicts the declared mode.
 *
 * Both directions are enforced, not just the obviously dangerous one:
 *   - `dev`/`prod` pointing at loopback is a deployed service that would boot,
 *     find no database inside its own container, and fail on the first query.
 *   - `local` pointing at a remote host is how a developer's test order, demo
 *     seed, or `migrate dev` reset lands in shared data. That is the direction
 *     that has actually nearly happened on this project, twice.
 */
export function assertDatabaseHost(mode: AppMode, url: string): void {
  const host = databaseHost(url);

  // Unparseable or socket-based: nothing to judge. Prisma will complain with a
  // better message than anything this module could produce.
  if (!host) return;

  const loopback = isLoopbackHost(host);

  if (mode === 'local' && !loopback) {
    throw new Error(
      `APP_MODE="local" but DATABASE_URL points at a remote host ("${host}"). ` +
        `Local mode is for a database on this machine — pointing it elsewhere means ` +
        `local testing, demo seeding and \`migrate dev\` all write to shared data. ` +
        `Set APP_MODE=dev (or prod) to target a remote database on purpose.`,
    );
  }

  if (mode !== 'local' && loopback) {
    throw new Error(
      `APP_MODE="${mode}" but DATABASE_URL points at a local host ("${host}"). ` +
        `A deployed service has no database inside its own container, so every query ` +
        `would fail after a successful boot. Set DATABASE_URL_${mode.toUpperCase()} to ` +
        `the real ${mode} database, or set APP_MODE=local if this is a local run.`,
    );
  }
}

/**
 * Resolves both mode-selected values, or throws with a message naming the
 * exact variable to set.
 *
 * Takes an env bag rather than reading `process.env` directly so the test
 * suite can exercise every branch without re-importing the module under a
 * mutated environment.
 */
export function resolveModeConfig(rawEnv: Record<string, string | undefined>): {
  mode: AppMode;
  databaseUrl: string;
  corsOrigins: string;
} {
  const mode = readAppMode(rawEnv.APP_MODE);

  const database = selectForMode(
    mode,
    {
      local: rawEnv.DATABASE_URL_LOCAL,
      dev: rawEnv.DATABASE_URL_DEV,
      prod: rawEnv.DATABASE_URL_PROD,
    },
    rawEnv.DATABASE_URL,
  );

  if (!database.value) {
    throw new Error(
      `No database URL is configured for APP_MODE="${mode}". ` +
        `Set DATABASE_URL_${mode.toUpperCase()} (preferred) or DATABASE_URL. ` +
        `There is deliberately no default — a missing value must fail at boot rather ` +
        `than let the process start pointed at nothing.`,
    );
  }

  assertDatabaseHost(mode, database.value);

  const cors = selectForMode(
    mode,
    {
      local: rawEnv.CORS_ORIGINS_LOCAL,
      dev: rawEnv.CORS_ORIGINS_DEV,
      prod: rawEnv.CORS_ORIGINS_PROD,
    },
    rawEnv.CORS_ORIGINS,
  );

  if (!cors.value) {
    throw new Error(
      `No CORS origins are configured for APP_MODE="${mode}". ` +
        `Set CORS_ORIGINS_${mode.toUpperCase()} (preferred) or CORS_ORIGINS. ` +
        `An empty allowlist blocks the frontend entirely, so this is never a safe ` +
        `default to guess — name the origins explicitly, even for local.`,
    );
  }

  return { mode, databaseUrl: database.value, corsOrigins: cors.value };
}
