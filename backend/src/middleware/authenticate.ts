import type { Request, Response, NextFunction } from 'express';

import { AppError } from '../errors/AppError.js';
import { getAuthenticatedUser, verifyToken, type SafeUser } from '../services/auth.service.js';

/**
 * Requires a valid Bearer token, and attaches the live user to the request.
 *
 * Mount on every route that isn't deliberately public. Per code-standards, auth
 * runs BEFORE handler logic — never as a check inside the handler, which is how
 * routes get shipped unprotected.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /// Only present after `authenticate` has run. Routes behind it can rely
      /// on this; routes that aren't must not.
      user?: SafeUser;
    }
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, token] = header.split(' ');

  // Case-insensitive: RFC 7235 defines the scheme as case-insensitive, and
  // clients legitimately send "bearer".
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.header('authorization'));

    if (!token) {
      throw AppError.unauthorized('Authentication required');
    }

    const payload = verifyToken(token);

    // Re-read the user every request. The token proves who signed in, not that
    // the account is still active — a user deactivated a minute ago still holds
    // a validly-signed token until it expires.
    const user = await getAuthenticatedUser(payload.sub);

    req.user = user;

    // userId on every subsequent log line for this request, so an audit trail
    // exists even before the audit-log feature does.
    req.log = req.log.child({ userId: user.id });

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Narrowing helper for handlers behind `authenticate`.
 *
 * `req.user` is optional on the Express type because it is absent on public
 * routes. Rather than `req.user!` at every call site — which silently lies if
 * the middleware is ever removed — this throws a clear internal error.
 */
export function requireUser(req: Request): SafeUser {
  if (!req.user) {
    throw new Error(
      'requireUser() called on a route without the authenticate middleware. ' +
        'Mount authenticate before this handler.',
    );
  }
  return req.user;
}
