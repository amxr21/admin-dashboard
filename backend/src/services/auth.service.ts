import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { StaffRole, User } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { getSettingValue } from './settings.service.js';
import { createSession, type SessionContext } from './session.service.js';
// Namespaced: this file's own `verifyLoginCode` (the login-flow step) and
// two-factor.service.ts's `verifyLoginCode` (the raw code check) are
// different levels of the same operation — importing named would shadow one.
import * as twoFactor from './two-factor.service.js';

/**
 * Authentication logic. Kept out of the route so it is testable without HTTP
 * and so the failure paths are explicit rather than tangled in a handler.
 */

/** What goes inside the JWT. Never put anything sensitive here — a JWT is
 *  signed, not encrypted, and anyone holding it can read the payload. */
export interface TokenPayload {
  sub: string;
  role: StaffRole;
  /**
   * Token version, for revocation.
   *
   * Optional because tokens minted before this existed do not carry it.
   * Deploying must not sign everyone out — see getAuthenticatedUser.
   */
  tv?: number;
  /**
   * Session id, for PER-SESSION revocation (Session model, session.service.ts).
   *
   * Optional for the same rollout reason as `tv`: a token minted before this
   * shipped carries no `sid`, and it must keep working rather than logging
   * everyone out on deploy — `getAuthenticatedUser` only checks it when
   * present. Such a token simply cannot be individually revoked from the
   * sessions list; the bulk `tokenVersion` path still reaches it.
   */
  sid?: string;
}

/** A user as the API is allowed to return it. */
export type SafeUser = Omit<
  User,
  'passwordHash' | 'failedLoginAttempts' | 'lockedUntil'
>;

/**
 * Strip everything the client must never see.
 *
 * Returning a Prisma `User` directly leaks the bcrypt hash — offline crackable
 * — and the lockout counters, which tell an attacker exactly how many attempts
 * remain. Every route returning a user goes through this.
 */
export function toSafeUser(user: User): SafeUser {
  const {
    passwordHash: _passwordHash,
    failedLoginAttempts: _failedLoginAttempts,
    lockedUntil: _lockedUntil,
    ...safe
  } = user;
  return safe;
}

/**
 * `expiresIn` defaults to the env-configured fallback so every existing
 * caller (mainly test setup, which mints tokens directly rather than through
 * `login()`) keeps working unchanged. `login()` is the one real caller that
 * passes an explicit value, sourced from `security.sessionTimeoutMinutes` —
 * see there for why the settings read has to happen at that call site rather
 * than in here.
 */
export function signToken(
  user: Pick<User, 'id' | 'role' | 'tokenVersion'>,
  expiresIn: string = env.JWT_EXPIRES_IN,
  sessionId?: string,
): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
      ...(sessionId ? { sid: sessionId } : {}),
    } satisfies TokenPayload,
    env.JWT_SECRET,
    { expiresIn } as jwt.SignOptions,
  );
}

/**
 * Verify a token's signature and shape.
 *
 * Throws `AppError.unauthorized` for every failure mode — expired, malformed,
 * wrong signature — deliberately with the SAME message. Telling a caller
 * whether a token was expired vs forged is free reconnaissance.
 */
export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    // `jwt.verify` returns `string | JwtPayload`; narrow it rather than casting,
    // so a malformed-but-correctly-signed token can't slip through as valid.
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
      throw AppError.unauthorized('Invalid or expired session');
    }

    /**
     * A pending-2FA token (`type: 'pending-2fa'`, see `signPending2faToken`)
     * MUST be refused here. It carries the same `sub` a real session token
     * does and is signed with the same `JWT_SECRET`, so without this check
     * it would decode successfully, `decoded.role` would just be `undefined`
     * cast to `StaffRole`, and `getAuthenticatedUser` would happily load the
     * real user and grant a full session — meaning the ~2-minute window
     * between "password correct" and "2FA code entered" would be a full
     * bypass of the second factor. Caught by two-factor.test.ts, not
     * assumed safe from the design alone.
     */
    if ('type' in decoded && decoded.type !== undefined) {
      throw AppError.unauthorized('Invalid or expired session');
    }

    return {
      sub: decoded.sub,
      role: decoded.role as StaffRole,
      /**
       * Carried through, not dropped.
       *
       * This function rebuilds the payload field by field rather than casting,
       * which is the right instinct — but it means a field added to the token
       * and NOT added here is silently lost. Revocation looked completely
       * implemented and did nothing at all until this line existed.
       *
       * Narrowed to a number so a forged `tv: "0"` cannot compare loosely.
       */
      ...(typeof decoded.tv === 'number' ? { tv: decoded.tv } : {}),
      ...(typeof decoded.sid === 'string' ? { sid: decoded.sid } : {}),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized('Invalid or expired session');
  }
}

/** True when the account is currently locked out. */
function isLocked(user: Pick<User, 'lockedUntil'>): boolean {
  return user.lockedUntil !== null && user.lockedUntil > new Date();
}

/**
 * Record a failed attempt and lock the account once the threshold is crossed.
 *
 * Separate from the per-IP rate limiter on purpose: IP limiting does not stop a
 * slow distributed attack on one known admin email, and account lockout does
 * not stop one IP spraying many accounts. Both are needed.
 */
async function registerFailedAttempt(user: User): Promise<void> {
  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = attempts >= env.LOGIN_MAX_ATTEMPTS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
      lockedUntil: shouldLock
        ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000)
        : user.lockedUntil,
    },
  });
}

export interface LoginResult {
  twoFactorRequired?: false;
  token: string;
  user: SafeUser;
}

/**
 * Returned instead of `LoginResult` when the account has 2FA enabled. The
 * password already checked out — that is what `pendingToken` proves — but
 * NO session exists yet, `lastLoginAt` has NOT been updated, and the
 * lockout counter reset has NOT happened. Those all wait for
 * `verifyLoginCode` to actually succeed; a correct password plus an
 * abandoned 2FA prompt must look, from every other system's perspective,
 * exactly like a login that never happened.
 */
export interface TwoFactorRequiredResult {
  twoFactorRequired: true;
  /** Short-lived, single-purpose JWT. Carries no `role`, `tv`, or `sid` —
   * nothing `authenticate` could mistake for a real session even if its own
   * type check were ever bypassed by a bug. */
  pendingToken: string;
}

const PENDING_2FA_TOKEN_TYPE = 'pending-2fa';
const PENDING_2FA_TTL = '2m';

interface Pending2faPayload {
  sub: string;
  type: typeof PENDING_2FA_TOKEN_TYPE;
}

function signPending2faToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: PENDING_2FA_TOKEN_TYPE } satisfies Pending2faPayload,
    env.JWT_SECRET,
    { expiresIn: PENDING_2FA_TTL } as jwt.SignOptions,
  );
}

/**
 * Verify a pending-2FA token specifically. Deliberately NOT a code path
 * `verifyToken` shares — a real session token and a pending-2FA token must
 * never be interchangeable, so this rejects anything without the exact
 * `type` marker rather than trying to make one function handle both shapes.
 */
function verifyPending2faToken(token: string): string {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (
      typeof decoded === 'string' ||
      decoded.type !== PENDING_2FA_TOKEN_TYPE ||
      typeof decoded.sub !== 'string'
    ) {
      throw AppError.unauthorized('This code has expired. Sign in again.');
    }

    return decoded.sub;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized('This code has expired. Sign in again.');
  }
}

/**
 * Authenticate an email + password.
 *
 * Every rejection returns the SAME 401 message. Distinguishing "no such user"
 * from "wrong password" turns the login form into a user-enumeration oracle:
 * an attacker learns which emails are real without ever guessing a password.
 *
 * The one deliberate exception is the lockout message — a locked-out legitimate
 * user needs to know why they cannot get in, and by that point the attacker has
 * already been stopped.
 */
export async function login(
  email: string,
  password: string,
  sessionContext: SessionContext = {},
): Promise<LoginResult | TwoFactorRequiredResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Hash anyway. Returning early here makes "user not found" measurably
    // faster than "wrong password", and that timing difference is itself a
    // user-enumeration oracle.
    await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw AppError.unauthorized('Invalid email or password');
  }

  if (isLocked(user)) {
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${env.LOGIN_LOCKOUT_MINUTES} minutes.`,
    );
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    await registerFailedAttempt(user);
    throw AppError.unauthorized('Invalid email or password');
  }

  // Checked AFTER the password, on purpose: an attacker without the password
  // should not be able to discover which accounts are disabled or expired.
  if (!user.isActive) {
    throw AppError.forbidden('This account has been deactivated');
  }

  if (user.accessExpiresAt !== null && user.accessExpiresAt < new Date()) {
    throw AppError.forbidden('This account’s access period has ended');
  }

  /**
   * STOP HERE for a 2FA account. Nothing below this point may run yet:
   * `lastLoginAt`/lockout-reset and session creation both have to wait for
   * `verifyLoginCode` to actually succeed, or an attacker with a stolen
   * password (but no phone) could tell from `lastLoginAt` alone that the
   * password worked — and a real session would exist for a login that, from
   * every other system's perspective, must look like it never happened.
   */
  if (user.twoFactorEnabled) {
    return { twoFactorRequired: true, pendingToken: signPending2faToken(user.id) };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    // Successful login clears the lockout state — otherwise a user who failed
    // four times and then succeeded stays one mistake away from a lockout.
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  // Read live rather than cached: a shortened timeout should take effect on
  // the very next login, not wait for a process restart.
  const sessionTimeoutMinutes = await getSettingValue('security.sessionTimeoutMinutes');

  const session = await createSession(user.id, sessionContext);

  return {
    token: signToken(updated, `${String(sessionTimeoutMinutes)}m`, session.id),
    user: toSafeUser(updated),
  };
}

/**
 * Second step of a 2FA login: exchange the pending token plus a real code
 * (TOTP or backup) for an actual session. This is the ONLY place
 * `lastLoginAt`/lockout-reset/session-creation happen for a 2FA account —
 * mirroring exactly what the non-2FA branch of `login()` does at its tail,
 * so a 2FA account and a non-2FA account end up in an identical state after
 * a successful sign-in.
 */
export async function verifyLoginCode(
  pendingToken: string,
  code: string,
  sessionContext: SessionContext = {},
): Promise<LoginResult> {
  const userId = verifyPending2faToken(pendingToken);

  const user = await prisma.user.findUnique({ where: { id: userId } });

  // Re-checked, not assumed from the pending token: the account could have
  // been deactivated or had 2FA disabled by an admin in the ~2 minutes since
  // the password step.
  if (!user || !user.isActive || !user.twoFactorEnabled) {
    throw AppError.unauthorized('This code has expired. Sign in again.');
  }

  const isValid = await twoFactor.verifyLoginCode(user.id, code);
  if (!isValid) {
    throw AppError.badRequest('That code is incorrect', { field: 'code' });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  const sessionTimeoutMinutes = await getSettingValue('security.sessionTimeoutMinutes');
  const session = await createSession(user.id, sessionContext);

  return {
    token: signToken(updated, `${String(sessionTimeoutMinutes)}m`, session.id),
    user: toSafeUser(updated),
  };
}

/**
 * Load the user behind a verified token.
 *
 * The token proves who signed in; it does NOT prove the account is still valid.
 * A user deactivated or expired five minutes ago still holds a signed token, so
 * these checks have to run per-request until token revocation exists
 * (see docs/PROJECT_STATUS.md).
 */
export async function getAuthenticatedUser(
  userId: string,
  tokenVersion?: number,
  sessionId?: string,
): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || !user.isActive) {
    throw AppError.unauthorized('Invalid or expired session');
  }

  if (user.accessExpiresAt !== null && user.accessExpiresAt < new Date()) {
    throw AppError.unauthorized('Invalid or expired session');
  }

  /**
   * REVOCATION. A token minted before the version was bumped is dead, even
   * though its signature is valid and it has not expired.
   *
   * Tokens issued before this feature existed carry no `tv`, so they are
   * accepted once — otherwise deploying it would sign every user out. They are
   * invalidated by the first bump, which is the right trade: no forced logout
   * on deploy, and full revocation available the moment it is actually needed.
   */
  if (tokenVersion !== undefined && tokenVersion !== user.tokenVersion) {
    throw AppError.unauthorized('Invalid or expired session');
  }

  /**
   * PER-SESSION revocation. Only checked when the token actually carries a
   * session id — same graceful-rollout shape as `tv` above: a token minted
   * before Sessions existed has no `sid` and is accepted on this check alone
   * (it is still fully covered by the `tokenVersion` check above).
   *
   * The query is intentionally separate from `session.service.ts`'s own
   * `isSessionLive` rather than imported — importing it here would make
   * `auth.service.ts` depend on `session.service.ts`, which already depends
   * on nothing auth-specific; keeping the dependency one-directional avoids a
   * cycle risk for a single WHERE clause's worth of savings.
   */
  if (sessionId !== undefined) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true },
    });

    if (!session || session.userId !== userId || session.revokedAt !== null) {
      throw AppError.unauthorized('Invalid or expired session');
    }
  }

  return toSafeUser(user);
}

/**
 * Invalidate every token this user holds, on every device.
 *
 * Called on password change and on deactivation. Both are moments where
 * leaving the old session working means the action did not actually do what
 * the person asked for — "I reset their password" has to mean they are out.
 */
export async function revokeSessions(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }),
    // Keeps `session.service.ts`'s list truthful: without this, a password
    // change elsewhere leaves every session row looking live even though
    // every token pointing at them is now dead on the `tokenVersion` check.
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
