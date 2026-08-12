import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import type { SafeUser } from './auth.service.js';

/**
 * API keys — B3.2's "Integrations & API" section.
 *
 * ─── A KEY IS ITS OWNER, NOT A SECOND PERMISSION SYSTEM ───────────────
 * `ApiKey` has no scope list of its own (see the schema's own doc comment).
 * A request authenticated by key checks `canAccessArea` against the OWNING
 * user's role, exactly like a browser session does. Two independent
 * permission systems checking two different things is how one of them ends
 * up silently wrong; one system, two ways to prove who you are, is not.
 *
 * ─── SHAPE OF THE PLAINTEXT KEY ────────────────────────────────────────
 * `adk_` prefix (Admin Dashboard Key) makes a leaked key grep-able in logs
 * and recognisable in a code review, the same reason Stripe/GitHub keys are
 * prefixed. 32 random bytes, base64url — not the human-dictated alphabet
 * `password-reset.service.ts` uses (that one is read aloud over a phone
 * call; this one is pasted into a `.env` file, so URL-safety and entropy
 * matter more than being easy to say).
 */

const KEY_PREFIX = 'adk_';

function generatePlainKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

function hashKey(plain: string): string {
  return createHmac('sha256', env.API_KEY_SECRET).update(plain).digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** First 8 and last 4 characters of the plaintext (after the prefix), so a
 * list of keys is tellable apart without ever storing anything the
 * plaintext could be reconstructed from. */
function previewOf(plain: string): string {
  const body = plain.slice(KEY_PREFIX.length);
  return `${KEY_PREFIX}${body.slice(0, 8)}…${body.slice(-4)}`;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPreview: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Every LIVE key for a user, newest-first — same "gone once revoked, not
 * marked dead in place" convention `session.service.ts` uses. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const rows = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, keyPreview: true, lastUsedAt: true, createdAt: true },
  });

  return rows.map((row) => ({
    ...row,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface CreatedApiKey {
  id: string;
  name: string;
  /** Plaintext, returned exactly once — same one-time-reveal contract as a
   * courier access code, password-reset token, or 2FA backup code. */
  key: string;
}

const MAX_LIVE_KEYS_PER_USER = 20;

export async function createApiKey(userId: string, name: string): Promise<CreatedApiKey> {
  // A soft ceiling, not a hard security boundary — it exists so an
  // automation bug that calls this endpoint in a loop fails loudly with a
  // clear message rather than silently filling the table one row at a time.
  const liveCount = await prisma.apiKey.count({ where: { userId, revokedAt: null } });
  if (liveCount >= MAX_LIVE_KEYS_PER_USER) {
    throw AppError.badRequest(
      `You already have ${String(MAX_LIVE_KEYS_PER_USER)} active keys — revoke one before creating another`,
    );
  }

  const plain = generatePlainKey();

  const row = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash: hashKey(plain),
      keyPreview: previewOf(plain),
    },
    select: { id: true, name: true },
  });

  return { ...row, key: plain };
}

/**
 * Revoke one key. Scoped to `userId` in the WHERE clause, not just the key
 * id — same reasoning as `session.service.ts`'s `revokeSession`: an id alone
 * is not an ownership check.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  await prisma.apiKey.updateMany({
    where: { id: keyId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Verify a presented key and return the user it authenticates as — the
 * OWNER's own role, not a scope carried on the key. Called from
 * `authenticate` as a fallback when no Bearer session token is present.
 *
 * Deliberately does NOT check `canAccessArea` itself — that stays
 * `requireArea`'s job, identical to how a session-authenticated request is
 * checked, so a key-authenticated request is indistinguishable from a
 * session-authenticated one everywhere past this point.
 */
export async function authenticateApiKey(plainKey: string): Promise<SafeUser | null> {
  const hash = hashKey(plainKey);

  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    include: { user: true },
  });

  if (!row || row.revokedAt !== null) return null;
  if (!hashesMatch(row.keyHash, hash)) return null;
  if (!row.user.isActive) return null;
  if (row.user.accessExpiresAt !== null && row.user.accessExpiresAt < new Date()) return null;

  // Fire-and-forget, same shape as `session.service.ts`'s `touchSession` —
  // losing one "last used" update is invisible and not worth failing the
  // request over.
  void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {
    // Silently dropped, deliberately — see touchSession's identical note.
  });

  const {
    passwordHash: _passwordHash,
    failedLoginAttempts: _failedLoginAttempts,
    lockedUntil: _lockedUntil,
    ...safe
  } = row.user;

  return safe;
}
