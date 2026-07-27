/**
 * An error the API deliberately produced and is safe to show the caller.
 *
 * The distinction that matters:
 *   - `AppError`      → expected failure. "Not found", "forbidden", "invalid
 *                       input". Message goes to the client verbatim. NOT sent
 *                       to Sentry — these are not bugs, and burying real
 *                       incidents in 404 noise is how alerting dies.
 *   - anything else   → unexpected. The client gets a generic message and a
 *                       requestId; the real error goes to Sentry and the logs.
 *
 * Never throw a raw Error with a message you intend the user to read — the
 * error handler will replace it with "Internal server error", by design.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Optional structured detail, e.g. per-field validation messages. */
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }

  // ─── Shorthands for the cases you'll actually use ────────────────
  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  /**
   * `details` is optional here for the same reason it exists on badRequest:
   * a refusal tied to one field ("you cannot grant a role above your own")
   * should land on that field in the form, not as a banner the user has to
   * map back to a control themselves.
   */
  static forbidden(
    message = 'You do not have access to this resource',
    details?: unknown,
  ): AppError {
    return new AppError(403, 'FORBIDDEN', message, details);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'CONFLICT', message, details);
  }
}
