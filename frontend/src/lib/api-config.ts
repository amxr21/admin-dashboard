/**
 * Resolves the Express API base URL from an explicit, declared mode.
 *
 * Why this file exists:
 * `api.ts` and `courier-api.ts` each used to read
 * `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'`.
 * `NEXT_PUBLIC_*` is inlined at BUILD time, so a Vercel build that forgot the
 * variable shipped a bundle pointing at `localhost:4000` — which then resolves
 * against the VISITOR's own machine. The failure looks like a network blip in
 * the browser console, names nothing, and points at no missing config. A
 * silent fallback to local is the one outcome this module exists to prevent.
 *
 * The contract: the environment declares WHICH environment it is
 * (`NEXT_PUBLIC_APP_MODE`), and a matching URL must exist for it. Nothing is
 * ever guessed, and no mode has a default URL to fall back to.
 *
 *   local → NEXT_PUBLIC_API_URL_LOCAL   (must be a loopback host)
 *   dev   → NEXT_PUBLIC_API_URL_DEV     (must NOT be a loopback host)
 *   prod  → NEXT_PUBLIC_API_URL_PROD    (must NOT be a loopback host)
 *
 * Both directions are enforced, not just the dangerous one: a `local` mode
 * pointing at the production backend is how a developer's test order ends up
 * in real data, so it is refused the same way.
 *
 * Every check runs at module scope, which Next.js evaluates during
 * `next build`. A misconfigured deploy is a RED BUILD, not a broken page.
 */

/** The environments this app can be pointed at. */
export type AppMode = 'local' | 'dev' | 'prod';

const APP_MODES: readonly AppMode[] = ['local', 'dev', 'prod'];

/**
 * `dev` is the default because it is the safe wrong answer. An unset mode on a
 * deployed frontend gets the shared dev backend — visibly wrong data, quickly
 * noticed, no real records touched. Defaulting to `local` would reproduce the
 * exact silent-localhost bug this module replaces, and defaulting to `prod`
 * would point a stray preview build at live customer data.
 */
const DEFAULT_MODE: AppMode = 'dev';

/**
 * Next.js inlines `NEXT_PUBLIC_*` by matching the literal source text
 * `process.env.NEXT_PUBLIC_FOO`. A computed lookup (`process.env[name]`)
 * is NOT substituted and reads as `undefined` in the browser bundle, so each
 * variable has to be written out longhand here. This is the reason this file
 * reads repetitively rather than looping over the mode list.
 */
const RAW_URL_BY_MODE: Record<AppMode, string | undefined> = {
  local: process.env.NEXT_PUBLIC_API_URL_LOCAL,
  dev: process.env.NEXT_PUBLIC_API_URL_DEV,
  prod: process.env.NEXT_PUBLIC_API_URL_PROD,
};

/**
 * The pre-existing single-URL variable, still honoured so an already-deployed
 * Vercel/CI environment keeps working after this change.
 *
 * It is an override, not a fallback: it is validated against the active mode
 * exactly like a per-mode value, so it cannot smuggle a localhost URL into a
 * `prod` build. That is the whole point — a compatibility path that skipped
 * the guards would reintroduce the bug under a different variable name.
 */
const LEGACY_URL = process.env.NEXT_PUBLIC_API_URL;

/** Hosts that only ever resolve to the machine running the browser. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function readMode(): AppMode {
  const raw = process.env.NEXT_PUBLIC_APP_MODE?.trim().toLowerCase();

  if (!raw) return DEFAULT_MODE;

  if (!APP_MODES.includes(raw as AppMode)) {
    throw new Error(
      `[api-config] NEXT_PUBLIC_APP_MODE is "${raw}", which is not a valid mode. ` +
        `Expected one of: ${APP_MODES.join(', ')}. ` +
        `Leave it unset to use the default ("${DEFAULT_MODE}").`,
    );
  }

  return raw as AppMode;
}

/**
 * Resolves and fully validates the base URL for `mode`.
 *
 * Exported so the test suite can exercise every branch without needing to
 * rebuild the module under a different environment each time.
 */
export function resolveApiUrl(
  mode: AppMode,
  urlByMode: Record<AppMode, string | undefined>,
  legacyUrl?: string,
): string {
  const perModeVar = `NEXT_PUBLIC_API_URL_${mode.toUpperCase()}`;
  const raw = urlByMode[mode]?.trim() || legacyUrl?.trim();

  if (!raw) {
    throw new Error(
      `[api-config] No API URL is configured for NEXT_PUBLIC_APP_MODE="${mode}". ` +
        `Set ${perModeVar} (preferred) or NEXT_PUBLIC_API_URL. ` +
        `There is deliberately no default — a missing value must fail the build ` +
        `rather than silently fall back to a local backend.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `[api-config] The API URL for mode "${mode}" is not a valid absolute URL: "${raw}". ` +
        `It must include the scheme and the API prefix, e.g. ` +
        `https://api.example.com/api/v1`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `[api-config] The API URL for mode "${mode}" uses an unsupported protocol ` +
        `"${parsed.protocol}": "${raw}". Only http: and https: are valid.`,
    );
  }

  const loopback = isLoopbackHost(parsed.hostname);

  // The guard this module was written for: a deployed build must never be
  // able to point the browser at the visitor's own machine.
  if (mode !== 'local' && loopback) {
    throw new Error(
      `[api-config] NEXT_PUBLIC_APP_MODE="${mode}" but the API URL points at a local ` +
        `host: "${raw}". A deployed build inlines this value into the browser bundle, ` +
        `so every visitor would call their OWN machine and see an unexplained network ` +
        `error. Set ${perModeVar} to the real ${mode} backend, or set ` +
        `NEXT_PUBLIC_APP_MODE=local if this is a local build.`,
    );
  }

  // The mirror guard: local work must not reach a shared backend by accident.
  if (mode === 'local' && !loopback) {
    throw new Error(
      `[api-config] NEXT_PUBLIC_APP_MODE="local" but the API URL points at a remote ` +
        `host: "${raw}". Local mode is for a backend on this machine — pointing it at a ` +
        `shared environment means local testing writes to shared data. Use ` +
        `NEXT_PUBLIC_APP_MODE=dev (or prod) to target a remote backend on purpose.`,
    );
  }

  // Trailing slashes are stripped so callers can append `/orders` without
  // producing `//orders`, which some routers 404 and others silently redirect.
  return raw.replace(/\/+$/, '');
}

/** The mode this bundle was built for. */
export const APP_MODE: AppMode = readMode();

/**
 * The validated API base URL, including the `/api/v1` prefix.
 *
 * Import this instead of reading `process.env` directly — a second raw read
 * elsewhere is a second place the guards can be bypassed.
 */
export const API_BASE_URL: string = resolveApiUrl(APP_MODE, RAW_URL_BY_MODE, LEGACY_URL);
