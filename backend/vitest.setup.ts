/**
 * Runs once before the backend test suite, BEFORE any application module is
 * imported.
 *
 * src/config/env.ts validates the environment at import time and calls
 * process.exit(1) if anything is missing — which, inside a test run, kills the
 * whole suite with no useful output. So required vars must be guaranteed here.
 *
 * Load .env FIRST, then apply CI fallbacks with `??=`. Getting this order
 * backwards is a real trap: env.ts also does `import 'dotenv/config'`, but by
 * the time it runs, `??=` below has already set DATABASE_URL to the fallback,
 * so dotenv's load becomes a no-op and local runs silently use the wrong DB.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'error'; // keep test output readable

// Fallback only applies when no .env is present at all (e.g. fresh CI
// container with its own MySQL service) — see .github/workflows/ci.yml.
process.env.DATABASE_URL ??= 'mysql://root:test@127.0.0.1:3306/admin_dashboard_test';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';

// No SENTRY_DSN on purpose — Sentry is disabled outside production/preview,
// and tests must never emit real events.
