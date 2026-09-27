import type { Request, Response, NextFunction } from 'express';
import { ApiKeyAudience, type StaffRole } from '@prisma/client';

import type { Area } from '../config/roles.js';
import { AppError } from '../errors/AppError.js';
import { getAuthenticatedUser, verifyToken, type SafeUser } from '../services/auth.service.js';
import { touchSession } from '../services/session.service.js';
import { authenticateApiKey, type AuthenticatedApiKey } from '../services/api-key.service.js';
import { routeHasAreaGuard } from './area-guard.js';
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
      /// The verified integration key behind this request — set by key
      /// authentication, never read from a header. Rate limits key on it.
      apiKeyId?: string;
      /// The branch this request is acting on (F8.4), from the `X-Branch-Id`
      /// header. `null` means "all branches", which is a real request — the
      /// unscoped reports answer exactly that — and never means "denied".
      ///
      /// Set by `withBranchContext`, which also resolves `branchRole` below.
      /// A route without that middleware sees `undefined`, not `null`, so the
      /// two states stay distinguishable: "no branch asked for" versus "this
      /// request never went through branch resolution at all".
      branchId?: string | null;
      /// The role this user holds AT `branchId` — their global `user.role`
      /// when they have no assignment there, or when no branch was named.
      ///
      /// This is what authorisation reads. `user.role` remains the
      /// business-wide role and is NOT the effective one on a scoped request.
      branchRole?: StaffRole;
      /// The areas the API KEY that authenticated this request may reach.
      ///
      /// `undefined` on a session-authenticated request (there is no key) and
      /// `null` for a key with no scope — both mean "the owner's own
      /// permissions decide, unrestricted". A non-null array NARROWS: the area
      /// must appear in it AND the owner must hold it.
      ///
      /// Deliberately not merged into `user`: a session produces the same
      /// `SafeUser`, and a scope has no meaning there.
      apiKeyScopes?: readonly Area[] | null;
      /// Which API surface the authenticating key was issued for. `undefined`
      /// on a session-authenticated request.
      apiKeyAudience?: ApiKeyAudience;
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

    if (token.startsWith(API_KEY_PREFIX)) {
      const authenticated = await authenticateViaApiKey(token);

      // A storefront key belongs on the public storefront API. Here it would
      // act as its owner — usually the Developer — so a leaked storefront
      // server key would open every order and customer record.
      if (authenticated.audience === ApiKeyAudience.STOREFRONT) {
        throw AppError.forbidden('This key only works with the storefront API');
      }

      // A scope narrows only where an area is checked. On a route with no area
      // guard it would narrow nothing, so a scoped key is refused there
      // rather than acting with its owner's full rights. See area-guard.ts.
      if (authenticated.scopes !== null && !routeHasAreaGuard(req)) {
        req.log.warn({ event: 'authz.scope.unguarded_route', method: req.method, path: req.originalUrl });
        throw AppError.forbidden('This key is limited to specific areas, and this endpoint is outside them');
      }

      req.user = authenticated.user;
      req.apiKeyId = authenticated.id;
      // Attached BEFORE any guard runs, so `requireArea` can narrow on it.
      req.apiKeyScopes = authenticated.scopes;
      req.apiKeyAudience = authenticated.audience;
    } else {
      req.user = await authenticateViaSession(req, token);
    }

    await finishAuthentication(req);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Authenticate the storefront integration independently from the shopper.
 * Customer routes already use `Authorization: Bearer <customer-token>`, so a
 * generated integration key has one unambiguous home: `X-API-Key`.
 */
export async function authenticateStorefrontApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.header('x-api-key')?.trim();
    if (!key) throw AppError.unauthorized('API key required');
    if (!key.startsWith(API_KEY_PREFIX)) throw AppError.unauthorized('Invalid API key');

    const authenticated = await authenticateApiKey(key);
    if (!authenticated) throw AppError.unauthorized('Invalid API key');

    // Keep the integration identity separate from `req.customer`. Ordinary
    // area guards can now apply the key owner's role AND its narrowed scopes.
    req.user = authenticated.user;
    req.apiKeyId = authenticated.id;
    req.apiKeyScopes = authenticated.scopes;
    req.apiKeyAudience = authenticated.audience;
    await finishAuthentication(req);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Refuse API-key authentication outright.
 *
 * A key is a credential FOR an account, never the account itself: it must not
 * change the profile, sessions or 2FA, and — the escalation this closes — it
 * must not mint more keys, which would let a narrowly scoped key issue itself
 * an unscoped one. Decided from the header, so it holds wherever it is mounted.
 */
export function refuseApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.header('authorization'));
  if (token?.startsWith(API_KEY_PREFIX)) {
    next(AppError.forbidden('API keys cannot manage an account — sign in to do this'));
    return;
  }
  next();
}

async function finishAuthentication(req: Request): Promise<void> {
  const user = requireUser(req);
  req.log = req.log.child({ userId: user.id });

  // A storefront key must not become a path around the account and
  // environment checks applied to the same key on admin endpoints.
  assertCanWrite(req);
  await assertNotInMaintenance(req);
  await assertIpAllowed(req);
  await assertTwoFactorCompliant(req);
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
async function authenticateViaApiKey(key: string): Promise<AuthenticatedApiKey> {
  const authenticated = await authenticateApiKey(key);

  // Same message as an invalid session token — telling a caller "the key
  // format was right but it's revoked" vs. "unknown key" is free
  // reconnaissance about which keys might once have existed.
  if (!authenticated) throw AppError.unauthorized('Invalid or expired session');

  return authenticated;
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
