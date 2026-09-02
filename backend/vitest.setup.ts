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

// Fallbacks only apply when no .env is present at all (e.g. a fresh CI
// container with its own MySQL service) — see .github/workflows/ci.yml.
process.env.DATABASE_URL ??= 'mysql://root:test@127.0.0.1:3306/admin_dashboard_test';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';

// ─── KEEP IN SYNC WITH src/config/env.ts ─────────────────────────────
// Every var env.ts marks REQUIRED needs a fallback here, or the suite dies at
// import time with "process.exit unexpectedly called with 1" — a message that
// does not name the missing variable, so it costs a CI round-trip to diagnose.
//
// Adding a required env var means touching FOUR places:
//   1. src/config/env.ts        (the schema)
//   2. backend/.env.example     (documentation)
//   3. backend/vitest.setup.ts  (this file)
//   4. .github/workflows/ci.yml (the test job's env block)
// Miss #3 or #4 and it passes locally, fails in CI.
//
// Test-only value: valid (32+ chars) but deliberately not secret.
process.env.JWT_SECRET ??= 'test-only-secret-never-used-in-production-0123456789';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.LOGIN_MAX_ATTEMPTS ??= '5';
process.env.LOGIN_LOCKOUT_MINUTES ??= '15';

// Storefront. These are OPTIONAL in env.ts (unset = storefront sign-in is off,
// not a misconfiguration), so the suite would boot without them — pinned here
// so the customer-auth tests get a deterministic audience instead of depending
// on whether a local .env happens to define one.
process.env.GOOGLE_CLIENT_ID ??= 'test-only.apps.googleusercontent.com';
process.env.CUSTOMER_JWT_EXPIRES_IN ??= '30d';

// No SENTRY_DSN on purpose — Sentry is disabled outside production/preview,
// and tests must never emit real events.
