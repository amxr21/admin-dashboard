import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

/**
 * Per-IP rate limiters.
 *
 * This is HALF of the brute-force defence. The other half is the per-account
 * lockout in auth.service.ts, and both are needed because they fail in
 * different directions:
 *
 *   - IP limiting alone: a distributed attack (botnet, rotating proxies)
 *     against one known admin email never trips it.
 *   - Account lockout alone: a single IP can spray one password across
 *     hundreds of accounts without locking any of them.
 *
 * Neither is sufficient. Removing either one reopens the gap.
 *
 * NOTE: the store is in-memory, so counts are per-process. That matches the
 * current single-process Coolify deployment. Before adding API replicas or
 * clustered workers, move these limiters to one shared Redis-compatible store
 * or an attacker can multiply their budget by the process count.
 */

/**
 * Login attempts. Deliberately strict — a human signing in gets it right in a
 * handful of tries, and anything beyond that is a script.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  // Return rate-limit info in the standard headers, not the legacy X-* ones.
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Failed attempts are what matter. Counting successes would lock out a
  // shared office IP where several staff sign in legitimately.
  skipSuccessfulRequests: true,
  // Matches the error envelope from errorHandler, so the frontend's ApiError
  // parses a 429 the same as any other failure rather than choking on a
  // different shape.
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts from this address. Try again shortly.',
    },
  },
});

/**
 * Password reset redemption. Unauthenticated by nature — anyone can submit a
 * token — so this is the ONLY defence against guessing one. As strict as
 * login: a real user redeems once, ever.
 */
export const passwordResetRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts from this address. Try again shortly.',
    },
  },
});

/**
 * Forgotten-password INITIATION (`POST /auth/forgot-password`).
 *
 * Deliberately not `passwordResetRateLimit`: that one sets
 * `skipSuccessfulRequests`, which is right for redemption (only guesses are
 * worth counting) and wrong here — initiation answers 200 whether or not the
 * address exists, so skipping successes would count nothing at all and leave
 * the endpoint unlimited.
 *
 * The limit protects two things the neutral response cannot: mailbox flooding
 * of a real user, and using response TIME as the enumeration oracle that the
 * identical body denies.
 */
export const passwordResetRequestRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts from this address. Try again shortly.',
    },
  },
});

/**
 * Stable, privacy-preserving reset-request identity.
 *
 * The limiter must follow an address across rotating IPs, but its in-memory
 * store must not become a readable list of staff addresses. HMAC (rather than
 * a plain hash) prevents an attacker who can inspect the store from checking a
 * dictionary of likely emails without also holding the reset secret.
 */
export function passwordResetIdentifierKey(email: unknown): string {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '__invalid__';

  return createHmac('sha256', env.PASSWORD_RESET_SECRET)
    .update(`password-reset-request:${normalized}`)
    .digest('hex');
}

/**
 * The other half of initiation throttling: one normalized address gets one
 * budget even when requests arrive through a botnet or rotating proxies.
 * Mounted after the IP limiter so both independent ceilings apply.
 */
export const passwordResetRequestIdentifierRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // `req.body` is `any` at this layer — the route's Zod schema runs AFTER the
  // limiter, by design (a limiter that only counted well-formed requests would
  // be bypassed by sending malformed ones). `passwordResetIdentifierKey`
  // already treats anything non-string as one shared bucket, so reading the
  // field defensively here is the whole contract.
  keyGenerator: (req: Request) => {
    const body: unknown = req.body;
    const email =
      typeof body === 'object' && body !== null && 'email' in body
        ? body.email
        : undefined;

    return passwordResetIdentifierKey(email);
  },
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts for this account. Try again shortly.',
    },
  },
});

/**
 * Self-service password change (`PATCH /auth/me/password`). Requires the
 * CURRENT password, verified via `bcrypt.compare` — that comparison is itself
 * a guessable-password oracle for whoever holds a valid session, so it needs
 * the same defence as login rather than inheriting the general write limiter.
 */
export const selfPasswordChangeRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts from this address. Try again shortly.',
    },
  },
});

/**
 * Courier access-code sign-in. As strict as staff login, for a stronger
 * reason: `DeliveryStaff` has no per-account lockout counter the way `User`
 * does (see `registerFailedAttempt` in auth.service.ts) — this limiter is
 * the ONLY brute-force defence a courier access code has.
 */
export const courierAuthRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts from this address. Try again shortly.',
    },
  },
});

/**
 * General API ceiling. Generous — this is a backstop against runaway clients
 * and scrapers, not a security control. Real protection is per-route.
 */
export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Slow down and try again shortly.',
    },
  },
});
