import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { StaffRole, User } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

/**
 * Authentication logic. Kept out of the route so it is testable without HTTP
 * and so the failure paths are explicit rather than tangled in a handler.
 */

/** What goes inside the JWT. Never put anything sensitive here — a JWT is
 *  signed, not encrypted, and anyone holding it can read the payload. */
export interface TokenPayload {
  sub: string;
  role: StaffRole;
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

export function signToken(user: Pick<User, 'id' | 'role'>): string {
  return jwt.sign({ sub: user.id, role: user.role } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
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

    return { sub: decoded.sub, role: decoded.role as StaffRole };
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
  token: string;
  user: SafeUser;
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
export async function login(email: string, password: string): Promise<LoginResult> {
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

  const updated = await prisma.user.update({
    where: { id: user.id },
    // Successful login clears the lockout state — otherwise a user who failed
    // four times and then succeeded stays one mistake away from a lockout.
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  return { token: signToken(updated), user: toSafeUser(updated) };
}

/**
 * Load the user behind a verified token.
 *
 * The token proves who signed in; it does NOT prove the account is still valid.
 * A user deactivated or expired five minutes ago still holds a signed token, so
 * these checks have to run per-request until token revocation exists
 * (see docs/PROJECT_STATUS.md).
 */
export async function getAuthenticatedUser(userId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || !user.isActive) {
    throw AppError.unauthorized('Invalid or expired session');
  }

  if (user.accessExpiresAt !== null && user.accessExpiresAt < new Date()) {
    throw AppError.unauthorized('Invalid or expired session');
  }

  return toSafeUser(user);
}
