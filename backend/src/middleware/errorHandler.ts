import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { Sentry } from '../sentry.js';
import { isProduction } from '../config/env.js';

/**
 * The single place an error turns into an HTTP response.
 *
 * Mount LAST in app.ts, after every route. Routes never build error responses
 * themselves — they `throw` (or `next(err)`) and this decides the shape.
 *
 * Response shape is identical for every failure in the API:
 *   { error: { code, message, requestId, details? } }
 *
 * The requestId is deliberately shown to the user. When they report "it broke",
 * that string takes you straight to the exact request in the logs.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Express can fire the error handler after headers are already sent (e.g. a
  // stream failed mid-response). Nothing useful left to do but hand it back.
  if (res.headersSent) {
    req.log.error({
      event: 'http.request.failed.afterHeadersSent',
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // ─── Expected failure: safe to show the caller ──────────────────
  if (err instanceof AppError) {
    req.log.warn({
      event: 'http.request.rejected',
      status: err.statusCode,
      errorCode: err.code,
      error: err.message,
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.requestId,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    });
    return;
  }

  // ─── Unexpected: a bug. Log it, ship it to Sentry, tell the user nothing ──
  req.log.error({
    event: 'http.request.errored',
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  Sentry.captureException(err, {
    tags: { requestId: req.requestId },
    // requestId only — never attach the body, headers, or user PII here.
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      // Leaking an internal message tells an attacker about your stack.
      // In dev it's the fastest way to see what went wrong.
      message: isProduction
        ? 'Internal server error'
        : err instanceof Error
          ? err.message
          : String(err),
      requestId: req.requestId,
    },
  });
}

/**
 * Catch-all for unmatched paths. Mount after the routers, before errorHandler,
 * so a typo'd URL returns the same JSON error shape as everything else rather
 * than Express's default HTML page.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}`));
}
