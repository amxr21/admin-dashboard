import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestContext } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { v1Router } from './routes/v1/index.js';

/**
 * Builds the Express app.
 *
 * Kept separate from server.ts (which owns the port and process lifecycle) so
 * integration tests can import `createApp()` and drive it with Supertest
 * without ever binding a socket.
 *
 * Middleware ORDER is load-bearing — do not shuffle these:
 *   1. helmet        → security headers on everything, including errors
 *   2. cors          → reject disallowed origins before doing any work
 *   3. json parser   → body available to handlers
 *   4. requestContext→ req.log exists from here on; everything below can log
 *   5. rate limit    → AFTER requestContext so a 429 is still logged with a
 *                      requestId, but BEFORE routes so it costs no DB work
 *   6. routes
 *   7. notFound      → unmatched paths become a normal AppError
 *   8. errorHandler  → LAST, always. Turns every failure into the same shape.
 */
export function createApp(): Express {
  const app = express();

  // Render/Vercel sit behind a proxy; without this, req.ip is the proxy's
  // address and rate limiting by IP would throttle every user as one.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    }),
  );

  // 1mb is generous for a JSON admin API and caps trivial payload-flood abuse.
  app.use(express.json({ limit: '1mb' }));

  app.use(requestContext);

  // Skips the health check: uptime probes poll it every few seconds and would
  // otherwise consume the budget that real traffic needs.
  app.use('/api/v1', (req, res, next) => {
    if (req.path === '/health') return next();
    return apiRateLimit(req, res, next);
  });

  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
