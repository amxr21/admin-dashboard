import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { StaffRole } from '@prisma/client';
import { Router } from 'express';

import { prisma } from '../../db/prisma.js';
import { env, isProduction } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/authorize.js';

/**
 * Developer diagnostics — "is the deployed thing healthy, and where do I look".
 *
 * ─── WHY requireRole AND NOT requireArea ─────────────────────────────
 * Areas describe the BUSINESS: orders, products, staff. This is not a business
 * area — it is a surface for whoever operates the system, and inventing an
 * `area: 'diagnostics'` would mean any role granted `*` inherits it. OWNER
 * holds `*`. So this is the case `requireRole` was written for and never used
 * on until now.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT RETURN ──────────────────────────
 * No connection strings, no secrets, no DSN, no env dump. Those are the things
 * a diagnostics page is most tempting to include and most dangerous to: it is
 * reachable over the network by a real session, so it is an exfiltration
 * target, and "developer only" is one role change away from not being true.
 *
 * It reports whether a thing is CONFIGURED (a boolean) and where its dashboard
 * lives (a URL someone would need to log into anyway) — never the credential.
 */

export const diagnosticsRouter = Router();

/** Read from package.json at boot, not per request. */
const startedAt = Date.now();

/**
 * Absolute path to `prisma/migrations/`, resolved relative to THIS file
 * rather than `process.cwd()` — the compiled file lives at
 * `dist/routes/v1/diagnostics.route.js` in production and
 * `src/routes/v1/diagnostics.route.ts` under `tsx` in dev, but both are three
 * levels below the backend root either way, so one relative path works for
 * both without an env var or a build-time constant.
 */
const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../prisma/migrations',
);

/**
 * Migration folders on disk vs. rows Prisma has actually recorded as applied.
 *
 * ─── WHY THIS IS READ-ONLY, WITH NO "APPLY" ACTION NEXT TO IT ────────────
 * `render.yaml`'s build command already runs `prisma migrate deploy` on every
 * deploy — migrations are applied automatically, before this process is even
 * serving traffic. Adding an HTTP-triggered "run migrations now" button next
 * to that would either do nothing (already applied) or fight the deploy
 * pipeline, and it would depend on the `prisma` CLI still being present at
 * runtime, which the build step needs but the running service does not.
 * What IS genuinely useful here — and what prompted this endpoint — is being
 * able to SEE the two ever disagree: a migration folder with no matching
 * applied row is exactly the "did the last deploy's migration silently fail"
 * question a developer currently has no way to answer without shelling into
 * the database directly.
 */
async function migrationStatus() {
  let onDisk: string[];

  try {
    const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
    onDisk = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    // Missing/unreadable dir reads as "unknown", not "zero migrations" — the
    // two must never be confused, since the latter would hide real drift.
    return { available: false as const, pending: [], appliedNotOnDisk: [] };
  }

  const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `.catch(() => []);
  const appliedNames = new Set(applied.map((row) => row.migration_name));

  return {
    available: true as const,
    // On disk, not yet applied — the real signal.
    pending: onDisk.filter((name) => !appliedNames.has(name)).sort(),
    // Applied, but the folder is gone — only possible if migrations/ was
    // pruned after deploy; surfaced rather than silently dropped.
    appliedNotOnDisk: [...appliedNames].filter((name) => !onDisk.includes(name)).sort(),
  };
}

/**
 * Row counts and on-disk size per table, straight from MySQL's own catalog
 * (`information_schema`) rather than `SELECT COUNT(*)` per table — the latter
 * is a full table scan under InnoDB and would make this endpoint itself a
 * load problem on a large table. `TABLE_ROWS` here is an ESTIMATE (InnoDB
 * does not track an exact live count), which is the right trade for a status
 * page and the reason it is labelled as such in the response shape.
 */
async function tableStats() {
  return prisma.$queryRaw<
    { table_name: string; approxRows: bigint | null; dataBytes: bigint | null; indexBytes: bigint | null }[]
  >`
    SELECT
      TABLE_NAME AS table_name,
      TABLE_ROWS AS approxRows,
      DATA_LENGTH AS dataBytes,
      INDEX_LENGTH AS indexBytes
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
  `.then((rows) =>
    rows.map((row) => ({
      table: row.table_name,
      approxRows: row.approxRows === null ? null : Number(row.approxRows),
      dataBytes: row.dataBytes === null ? null : Number(row.dataBytes),
      indexBytes: row.indexBytes === null ? null : Number(row.indexBytes),
    })),
  );
}

async function databaseCheck() {
  const began = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { reachable: true, latencyMs: Date.now() - began };
  } catch (error) {
    // The message could name the host, so only the SHAPE of the failure is
    // reported. The real error is already in the logs with a requestId.
    return {
      reachable: false,
      latencyMs: Date.now() - began,
      kind: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

diagnosticsRouter.get(
  '/diagnostics',
  authenticate,
  requireRole(StaffRole.DEVELOPER),
  async (req, res) => {
    const [database, migrations] = await Promise.all([
      databaseCheck(),
      prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
        SELECT migration_name, finished_at
        FROM _prisma_migrations
        ORDER BY finished_at DESC
        LIMIT 5
      `.catch(() => []),
    ]);

    res.json({
      data: {
        environment: env.NODE_ENV,
        isProduction,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        node: process.version,
        database,
        migrations: migrations.map((row) => ({
          name: row.migration_name,
          appliedAt: row.finished_at?.toISOString() ?? null,
        })),
        /**
         * Booleans and links only.
         *
         * `sentry.configured` says whether errors are actually being reported —
         * the question worth asking — without echoing the DSN. The dashboards
         * are optional: unset simply means "no link to offer", not an error,
         * because the RUN layer that provisions them is not applied yet.
         */
        observability: {
          sentry: {
            configured: Boolean(env.SENTRY_DSN),
            dashboard: env.SENTRY_DASHBOARD_URL ?? null,
          },
          logs: {
            dashboard: env.LOGS_DASHBOARD_URL ?? null,
          },
        },
      },
    });

    req.log.info({ event: 'diagnostics.viewed', userId: req.user?.id });
  },
);

/**
 * Everything below is DEVELOPER-only and read-only — see the comments on
 * `migrationStatus`/`tableStats` for why this stops short of any action that
 * changes the database, guarded-action-list scope rather than a raw query
 * console (this app's own security posture explicitly rules that out — see
 * `security-privacy-auditor` conventions this codebase follows elsewhere).
 */
diagnosticsRouter.get(
  '/diagnostics/db/migrations',
  authenticate,
  requireRole(StaffRole.DEVELOPER),
  async (req, res) => {
    res.json({ data: await migrationStatus() });
    req.log.info({ event: 'diagnostics.db.migrations.viewed', userId: req.user?.id });
  },
);

diagnosticsRouter.get(
  '/diagnostics/db/tables',
  authenticate,
  requireRole(StaffRole.DEVELOPER),
  async (req, res) => {
    res.json({ data: await tableStats() });
    req.log.info({ event: 'diagnostics.db.tables.viewed', userId: req.user?.id });
  },
);
