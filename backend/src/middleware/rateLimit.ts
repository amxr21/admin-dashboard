import rateLimit from 'express-rate-limit';

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
 * NOTE: the store is in-memory, so counts are per-process. On Render's free
 * tier that is one instance and this is correct. The moment the API scales to
 * multiple instances, this needs a shared store (Redis) or an attacker can
 * multiply their budget by the instance count. Tracked in PROJECT_STATUS.md.
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
