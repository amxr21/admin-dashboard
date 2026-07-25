import './sentry.js'; // MUST be first — see the note in sentry.ts

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { prisma } from './db/prisma.js';

/**
 * Process entry point. Owns the port and the lifecycle; app.ts owns the routes.
 */

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({
    event: 'server.started',
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  });
});

/**
 * Graceful shutdown.
 *
 * Render (and any container host) sends SIGTERM and then kills the process a
 * short time later. Without this, in-flight requests are severed mid-response
 * and DB connections are dropped rather than closed — which shows up as
 * random 502s during every deploy.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ event: 'server.shutdown.started', signal });

  server.close(() => {
    logger.info({ event: 'server.shutdown.httpClosed' });
  });

  try {
    await prisma.$disconnect();
    logger.info({ event: 'server.shutdown.complete' });
    process.exit(0);
  } catch (err) {
    logger.error({
      event: 'server.shutdown.failed',
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A rejected promise nobody awaited leaves the process in an unknown state.
// Log it loudly rather than letting Node's default warning scroll past.
process.on('unhandledRejection', (reason) => {
  logger.fatal({
    event: 'process.unhandledRejection',
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ event: 'process.uncaughtException', error: err.message });
  // The process is not trustworthy after this point — exit and let the host
  // restart it clean. Sentry has already captured it via its global handler.
  process.exit(1);
});
