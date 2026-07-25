import { Router } from 'express';
import { prisma } from '../../db/prisma.js';

/**
 * Health check for the host's uptime probe (Render pings this) and for
 * deploy smoke tests.
 *
 * It checks the database on purpose: a process that is running but cannot
 * reach MySQL is not healthy, and a probe that only proves "node is alive"
 * will happily keep a broken instance in the load balancer.
 *
 * Deliberately unversioned in spirit but mounted under /api/v1 for
 * consistency — infrastructure endpoints don't change shape.
 */

export const healthRouter = Router();

// GET /api/v1/health
healthRouter.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ data: { status: 'ok', db: 'ok' } });
  } catch (err) {
    req.log.error({
      event: 'health.check.failed',
      error: err instanceof Error ? err.message : String(err),
    });
    // 503, not 500 — "temporarily unable to serve", which is what a probe
    // needs to see to pull this instance out of rotation.
    res.status(503).json({ data: { status: 'degraded', db: 'unreachable' } });
  }
});
