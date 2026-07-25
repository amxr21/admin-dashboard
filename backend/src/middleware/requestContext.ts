import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger, type Logger } from '../logger.js';

/**
 * Attaches a per-request logger and requestId to every incoming request.
 *
 * Why this matters:
 * When something breaks in production, you filter your logs by
 * `requestId = "abc123"` and see the entire story of that one request —
 * every log line from every middleware, handler, and downstream call.
 * Without this, debugging is grep-through-a-novel.
 *
 * How to use in a route:
 *   req.log.info({ event: 'user.login.succeeded', userId: 42 });
 *   // → { requestId: 'abc123', userId: 42, event: 'user.login.succeeded', ... }
 */

// Extend Express types so `req.log` and `req.requestId` are typed downstream.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      log: Logger;
      requestId: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  // Respect an upstream requestId (from a load balancer / gateway) if present,
  // so a trace survives across service hops. Otherwise generate one.
  const requestId =
    req.header('x-request-id') ?? req.header('x-correlation-id') ?? randomUUID();

  req.requestId = requestId;
  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.path,
  });

  // Echo back so the client (and Sentry) can correlate.
  res.setHeader('x-request-id', requestId);

  // Log request completion with duration & status.
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    req.log.info({
      event: 'http.request.completed',
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });

  next();
}
