import type { Request, Response, NextFunction } from 'express';

import { AppError } from '../errors/AppError.js';
import { getAuthenticatedUser, verifyToken, type SafeUser } from '../services/auth.service.js';
import { touchSession } from '../services/session.service.js';
import { authenticateApiKey } from '../services/api-key.service.js';
import {
  assertCanWrite,
  assertIpAllowed,
  assertNotInMaintenance,
  assertTwoFactorCompliant,
} from './authorize.js';

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
      /// The `sid` claim of the JWT that authenticated this request, if any.
      /// Absent for API-key auth (keys have no session) and for a token
      /// minted before Sessions existed (see auth.service.ts's `sid?`
      /// comment) — routes that need "the current session" must handle
      /// undefined, not assume it's always there.
      sessionId?: string;
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

/** API keys (api-key.service.ts) are prefixed `adk_` — everything else
 * presented as a Bearer credential is treated as a session JWT. Distinguishing
 * by SHAPE rather than trying one and falling back to the other means a
 * malformed JWT never accidentally gets a second, slower attempt as an API
 * key lookup — one credential type, one code path, decided up front. */
const API_KEY_PREFIX = 'adk_';

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

    const user = token.startsWith(API_KEY_PREFIX)
      ? await authenticateViaApiKey(token)
      : await authenticateViaSession(req, token);

    req.user = user;

    // userId on every subsequent log line for this request, so an audit trail
    // exists even before the audit-log feature does.
    req.log = req.log.child({ userId: user.id });

    // Read-only roles (DEMO) are blocked from writes HERE, immediately after
    // identity is established. Deliberately not app-level middleware: that
    // would run before req.user exists and silently pass every write through.
    // Every authenticated route therefore gets this for free.
    assertCanWrite(req);
    await assertNotInMaintenance(req);
    // Unlike the two checks above, this runs for READS too — an allowlist
    // that only gated writes would still let a blocked network browse every
    // page, which defeats the point of a network-level restriction.
    await assertIpAllowed(req);
    await assertTwoFactorCompliant(req);

    next();
  } catch (err) {
    next(err);
  }
}

async function authenticateViaSession(req: Request, token: string): Promise<SafeUser> {
  const payload = verifyToken(token);

  // Re-read the user every request. The token proves who signed in, not that
  // the account is still active — a user deactivated a minute ago still holds
  // a validly-signed token until it expires.
  // `payload.tv` carries the token's version; the service compares it to the
  // row and refuses a token minted before the last revocation.
  const user = await getAuthenticatedUser(payload.sub, payload.tv, payload.sid);

  // Opportunistic, fire-and-forget — see session.service.ts for why this
  // isn't a write on every single request.
  if (payload.sid) touchSession(payload.sid);

  req.sessionId = payload.sid;

  return user;
}

/**
 * A key is its OWNER's exact permissions (see `ApiKey`'s schema doc comment
 * and `api-key.service.ts`) — this returns the same `SafeUser` shape a
 * session does, so every check downstream of `authenticate` (`requireArea`,
 * `assertCanWrite`, …) treats a key-authenticated request identically to a
 * session-authenticated one, with no second code path to keep in sync.
 */
async function authenticateViaApiKey(key: string): Promise<SafeUser> {
  const user = await authenticateApiKey(key);

  // Same message as an invalid session token — telling a caller "the key
  // format was right but it's revoked" vs. "unknown key" is free
  // reconnaissance about which keys might once have existed.
  if (!user) throw AppError.unauthorized('Invalid or expired session');

  return user;
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
