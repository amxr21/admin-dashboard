import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { sendEmailToRecipients } from './email.service.js';

/**
 * Admin-issued, single-use password reset tokens.
 *
 * ─── WHY A TOKEN AND NOT JUST `resetStaffPassword` AGAIN ─────────────
 * `staff.service.ts` already lets an admin set someone else's password
 * directly — but that means the admin TYPES the new password, so they end up
 * knowing it. A token lets the admin hand over a one-time credential without
 * ever learning what the locked-out person sets their password to.
 *
 * ─── SAME HMAC SHAPE AS COURIER ACCESS CODES ──────────────────────────
 * Never stored, never readable back — only a keyed HMAC. Deterministic so the
 * unique index resolves a redemption in one read, at the cost of the same
 * honest limitation: someone holding both the database and
 * PASSWORD_RESET_SECRET could brute-force a token offline. Mitigated by a
 * large alphabet, a short expiry, and rate limiting on redemption.
 */

/** No 0/O/1/I/L — this may be read off a chat message or a phone call. */
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 12 chars from a 31-char alphabet ≈ 59 bits, same entropy as a courier code. */
const TOKEN_LENGTH = 12;

/** Short-lived on purpose — this is handed over out of band (chat, call). */
const TOKEN_TTL_MINUTES = 30;

function generateToken(): string {
  let token = '';

  for (let i = 0; i < TOKEN_LENGTH; i += 1) {
    // randomInt, not Math.random — this is a credential.
    token += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
  }

  return `${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8)}`;
}

/** Normalised before hashing so formatting and case never affect the result. */
function hashToken(token: string): string {
  const normalised = token.replace(/[\s-]/g, '').toUpperCase();

  return createHmac('sha256', env.PASSWORD_RESET_SECRET).update(normalised).digest('hex');
}

/** Constant-time comparison — the lookup is by unique index, but no comparison here leaks timing. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');

  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Issue a new token for a user, invalidating any of their tokens still live.
 *
 * Only one outstanding token per user at a time — otherwise an admin who
 * issues twice (a chat message that didn't send, say) leaves two valid
 * credentials where the locked-out person only knows about one.
 *
 * `ttlMinutes` defaults to the 30-minute reset window. It is overridable for
 * exactly one other caller: a first-time staff invite (`inviteStaff` in
 * staff.service.ts), where 30 minutes is the wrong assumption — a reset is
 * handed over live (chat, call), an invite is typically opened hours or days
 * later. Same token, same redemption path, same one-time/expiring guarantees;
 * only the clock differs.
 */
export async function createResetToken(userId: string, ttlMinutes: number = TOKEN_TTL_MINUTES) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt },
    }),
  ]);

  return { token, expiresAt };
}

/**
 * Self-service initiation: the locked-out person asks for their own token.
 *
 * ─── WHY THIS RETURNS NOTHING ────────────────────────────────────────
 * The caller is unauthenticated and anonymous, so every observable —
 * status code, body, and as far as practical timing — must be identical
 * for a real address and an unknown one. Returning "sent" vs "no such
 * account" would turn this endpoint into a staff-directory oracle: an
 * attacker could enumerate who works here, then aim credential stuffing
 * at addresses already known to be valid.
 *
 * ─── WHY AN INACTIVE ACCOUNT IS ALSO A SILENT NO-OP ──────────────────
 * Same reasoning, one level deeper. A deactivated ex-employee's address
 * must not be resettable, but refusing it DIFFERENTLY would leak that the
 * account exists and is merely switched off.
 *
 * ─── WHY IT NEVER THROWS ON A MAIL FAILURE ───────────────────────────
 * `sendEmailToRecipients` already returns false rather than throwing when
 * SMTP is unconfigured or the send fails. Surfacing that to the caller
 * would mean an install with no SMTP answers differently from one with
 * it — the same leak again, in a quieter form. The failure is logged for
 * an operator instead, which is who can actually act on it.
 */
export async function requestPasswordReset(req: Request, email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, isActive: true },
  });

  if (!user || !user.isActive) {
    // Logged WITHOUT the address: this is an unauthenticated endpoint, so the
    // log would otherwise accumulate a list of addresses probed by anyone.
    req.log.info({ event: 'auth.password-reset.requested', delivered: false });
    return;
  }

  const { token, expiresAt } = await createResetToken(user.id);

  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000);
  const delivered = await sendEmailToRecipients(
    [user.email],
    'Reset your password',
    [
      `Hello${user.name ? ` ${user.name}` : ''},`,
      '',
      'Use this one-time code to set a new password:',
      '',
      `    ${token}`,
      '',
      `The code expires in ${minutes} minutes and can only be used once.`,
      'If you did not request this, you can ignore this message — your password has not changed.',
    ].join('\n'),
  );

  req.log.info({ event: 'auth.password-reset.requested', delivered });

  // The token itself is NEVER audited — `changes` records that a reset was
  // asked for, not the credential that would let anyone act on it.
  audit(req, {
    action: 'user.password-reset.requested',
    entity: 'user',
    entityId: user.id,
    changes: { delivered },
  });
}

/**
 * Redeem a token: set a new password, chosen by the person who holds it.
 *
 * Every failure — unknown token, already used, expired — gets the SAME
 * generic error. Telling them apart is an enumeration oracle over which
 * tokens exist and whether they were already claimed.
 */
export async function redeemResetToken(req: Request, tokenInput: string, password: string) {
  const invalid = () => AppError.badRequest('This reset link is invalid or has expired');

  const hash = hashToken(tokenInput);
  const passwordHash = await bcrypt.hash(password, 10);

  const userId = await prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hash },
      select: { id: true, userId: true, tokenHash: true },
    });

    if (!record) throw invalid();
    if (!hashesMatch(record.tokenHash, hash)) throw invalid();

    /**
     * Atomic claim, not a separate read-then-write.
     *
     * `usedAt: null` and `expiresAt: { gt: now }` live in the UPDATE's WHERE
     * clause, not a prior SELECT. Without this, two requests racing the same
     * token could both pass a "is it still valid" check before either write
     * lands, and both would go on to set a password — a single-use credential
     * used twice. This way only one `updateMany` can ever affect a row; the
     * loser sees `count === 0` and gets the same generic error as any other
     * invalid token.
     */
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    if (claim.count === 0) throw invalid();

    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        lockedUntil: null,
        failedLoginAttempts: 0,
        // Same reasoning as every other password change: the old session
        // must not keep working after this.
        tokenVersion: { increment: 1 },
      },
    });

    return record.userId;
  });

  // No authenticated actor here by definition — the whole point of the flow
  // is that the person redeeming cannot sign in yet. audit() logs whichever
  // actor fields req carries, which is none, and that absence is honest: this
  // action was taken by whoever held the token, not a staff session.
  audit(req, {
    action: 'user.password-reset.redeemed',
    entity: 'user',
    entityId: userId,
    changes: null,
  });
}
