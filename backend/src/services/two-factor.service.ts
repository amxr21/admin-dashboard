import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { authenticator } from 'otplib';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

/**
 * Two-factor authentication (TOTP).
 *
 * ─── WHY THIS SECRET IS ENCRYPTED, NOT HASHED ────────────────────────
 * Every OTHER credential-shaped value in this codebase (courier access
 * codes, password reset tokens) is HMAC-hashed — one-way, because the server
 * only ever needs to COMPARE a presented value against the stored one. A
 * TOTP secret is different: verifying a live 6-digit code means the server
 * must independently COMPUTE the same code the authenticator app is
 * computing, which requires the raw secret back. AES-256-GCM (authenticated
 * encryption — tampering is detected, not just undetected-and-wrong) is the
 * correct primitive here specifically because this is the one place in the
 * app that needs a value to come back OUT.
 *
 * ─── WHY BACKUP CODES ARE HASHED, NOT ENCRYPTED ──────────────────────
 * Backup codes only need comparison (same as a password), so they follow the
 * courier/reset-token pattern instead: HMAC-SHA256, single-use, never
 * decrypted back. Two different problems, two different primitives.
 *
 * ─── THE TWO-STEP LOGIN FLOW ──────────────────────────────────────────
 * `login()` in auth.service.ts, when it reaches a user with 2FA enabled,
 * does NOT issue a real session token. It issues a short-lived, purpose-typed
 * JWT (`type: 'pending-2fa'`) that proves "the password already checked out"
 * without being usable against any real endpoint — `authenticate` refuses
 * any token carrying that type. `verifyLoginCode` below exchanges it, plus a
 * valid 6-digit code (or backup code), for the real thing.
 */

const ALGORITHM = 'aes-256-gcm';

function twoFactorKey(): Buffer {
  return Buffer.from(env.TWO_FACTOR_SECRET, 'hex');
}

/** `iv:authTag:ciphertext`, all hex — self-contained, so decryption never
 * needs a second column or a fixed IV (reusing an IV with GCM is a real
 * cryptographic break, not just bad practice). */
function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit, the size GCM is designed around.
  const cipher = createCipheriv(ALGORITHM, twoFactorKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptSecret(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    // Malformed stored value — should be unreachable outside a corrupted
    // row, but failing loudly here is much better than feeding garbage into
    // createDecipheriv and getting a confusing native error instead.
    throw new Error('Malformed two-factor secret in storage');
  }

  const decipher = createDecipheriv(ALGORITHM, twoFactorKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const BACKUP_CODE_COUNT = 10;

function generateBackupCode(): string {
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function hashBackupCode(code: string): string {
  const normalised = code.replace(/[\s-]/g, '').toUpperCase();
  return createHmac('sha256', env.TWO_FACTOR_SECRET).update(normalised).digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface PendingSetup {
  secret: string;
  /** `otpauth://` URI — the caller renders this as a QR code (`qrcode`). */
  otpauthUri: string;
}

/**
 * Start enrolment: generate a secret, encrypt it, store it — but do NOT set
 * `twoFactorEnabled`. Login is not affected until `confirmSetup` proves the
 * person actually has a working authenticator, not just a scanned QR code
 * that might be for the wrong account or never got scanned at all.
 */
export async function beginSetup(userId: string, accountLabel: string): Promise<PendingSetup> {
  const secret = authenticator.generateSecret();

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false },
  });

  const otpauthUri = authenticator.keyuri(accountLabel, 'Admin Dashboard', secret);

  return { secret, otpauthUri };
}

export interface EnrolmentResult {
  /** Plaintext, returned exactly once — same one-time-reveal contract as a
   * courier access code or password-reset token. */
  backupCodes: string[];
}

/**
 * Finish enrolment: the caller must present a REAL code from their
 * authenticator app before 2FA actually starts being enforced.
 */
export async function confirmSetup(userId: string, code: string): Promise<EnrolmentResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorSecret: true },
  });

  if (!user.twoFactorSecret) {
    throw AppError.badRequest('Start setup before confirming a code');
  }

  const secret = decryptSecret(user.twoFactorSecret);
  if (!authenticator.verify({ token: code, secret })) {
    throw AppError.badRequest('That code is incorrect or expired', { field: 'code' });
  }

  const plainCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
    // Replaces any codes from an earlier, abandoned enrolment attempt — only
    // the codes issued with THIS confirmation should ever be valid.
    prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
    prisma.twoFactorBackupCode.createMany({
      data: plainCodes.map((plain) => ({ userId, codeHash: hashBackupCode(plain) })),
    }),
  ]);

  return { backupCodes: plainCodes };
}

/**
 * Turn 2FA off. Requires the CURRENT code — same reasoning as
 * `changeOwnPassword` requiring the current password: this is a security
 * DOWNGRADE, and nothing else vouches for the caller beyond a session token
 * that could belong to someone who found an unlocked laptop.
 */
export async function disableTwoFactor(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });

  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw AppError.badRequest('Two-factor authentication is not enabled');
  }

  if (!authenticator.verify({ token: code, secret: decryptSecret(user.twoFactorSecret) })) {
    throw AppError.badRequest('That code is incorrect or expired', { field: 'code' });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    }),
    prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
  ]);
}

/**
 * Verify a code at LOGIN TIME — either a real TOTP code or a backup code.
 * Never both checked as one type; a 10-character backup code and a 6-digit
 * TOTP code cannot collide in practice, but trying the cheap check first
 * (string shape) avoids doing a real TOTP computation for an obviously
 * backup-shaped input.
 */
export async function verifyLoginCode(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorSecret: true },
  });

  if (!user.twoFactorSecret) return false;

  const trimmed = code.trim();

  // Backup codes are always `XXXXX-XXXXX` shaped; a TOTP code is always 6
  // digits. Shape alone decides which path to take.
  if (/^[A-Z0-9]{5}-?[A-Z0-9]{5}$/i.test(trimmed)) {
    return consumeBackupCode(userId, trimmed);
  }

  const secret = decryptSecret(user.twoFactorSecret);
  return authenticator.verify({ token: trimmed, secret });
}

async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const hash = hashBackupCode(code);

  // Look up by the unique hash, then confirm ownership + hash equality with
  // a real timing-safe comparison — same defence-in-depth shape
  // `password-reset.service.ts` uses, even though a `findUnique` lookup
  // already implies equality; belt and braces for a security-critical path.
  const record = await prisma.twoFactorBackupCode.findUnique({
    where: { codeHash: hash },
    select: { id: true, userId: true, codeHash: true, usedAt: true },
  });

  if (!record || record.userId !== userId || record.usedAt !== null) return false;
  if (!hashesMatch(record.codeHash, hash)) return false;

  // Atomic claim, not read-then-write — same TOCTOU concern
  // `redeemResetToken` guards against: two requests racing the same code
  // must not both succeed.
  const claim = await prisma.twoFactorBackupCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  return claim.count === 1;
}

export interface TwoFactorStatus {
  enabled: boolean;
  /** Only meaningful when `enabled` — how many of the original ten backup
   * codes have not been used yet. */
  remainingBackupCodes: number;
}

export async function getStatus(userId: string): Promise<TwoFactorStatus> {
  const [user, remaining] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } }),
  ]);

  return { enabled: user.twoFactorEnabled, remainingBackupCodes: remaining };
}
