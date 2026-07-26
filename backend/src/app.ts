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
 *   5. browser noise → favicon/robots answered before they can become 404 WARNs
 *   6. rate limit    → AFTER requestContext so a 429 is still logged with a
 *                      requestId, but BEFORE routes so it costs no DB work
 *   7. routes
 *   8. notFound      → unmatched paths become a normal AppError
 *   9. errorHandler  → LAST, always. Turns every failure into the same shape.
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

  // Browser chrome requests these from EVERY origin it loads, unasked — open
  // the API in a tab and you get a 404 WARN per request forever. They are not
  // application traffic and answering them 404 teaches the log to cry wolf,
  // which is how real 404s stop getting noticed.
  //
  // 204 rather than 404: there is genuinely no content, and it stops the
  // browser retrying. This is an API — it has no favicon and wants no crawlers.
  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  // Skips the health check: uptime probes poll it every few seconds and would
  // otherwise consume the budget that real traffic needs.
  app.use('/api/v1', (req, res, next) => {
    if (req.path === '/health') return next();
    return apiRateLimit(req, res, next);
  });

  // NOTE: read-only (DEMO) write-blocking is NOT mounted here. It depends on
  // req.user, which `authenticate` sets inside each route — an app-level mount
  // would run first, see no user, and silently pass every write through.
  // It lives inside `authenticate` instead. See middleware/authorize.ts.
  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
