import { PrismaClient } from '@prisma/client';
import { isDevelopment } from '../config/env.js';
import { logger } from '../logger.js';

/**
 * Single shared Prisma client.
 *
 * One instance per process — each `new PrismaClient()` opens its own connection
 * pool, and a handful of stray instances will exhaust MySQL's connection limit
 * under no real load at all. Import this; never construct your own.
 *
 * The `globalThis` cache exists for `tsx watch`: a hot reload re-evaluates this
 * module, and without the cache every save would leak another pool.
 */

function createPrismaClient() {
  return new PrismaClient({
    // Route Prisma's own logs through pino so they land in the aggregator with
    // the same shape as everything else, instead of raw stdout.
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}

// Prisma types `$on` off the `log` option, so the client's type must carry that
// generic. Annotating the cache as plain `PrismaClient` would widen it back and
// make every event name `never` — hence inferring the type from the factory.
type AppPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: AppPrismaClient | undefined;
};

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

prisma.$on('warn', (event) => {
  logger.warn({ event: 'db.warn', message: event.message });
});

prisma.$on('error', (event) => {
  logger.error({ event: 'db.error', message: event.message });
});

if (isDevelopment) globalForPrisma.prisma = prisma;
