import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestContext } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
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
 *   5. routes
 *   6. notFound      → unmatched paths become a normal AppError
 *   7. errorHandler  → LAST, always. Turns every failure into the same shape.
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

  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
