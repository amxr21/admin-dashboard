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
