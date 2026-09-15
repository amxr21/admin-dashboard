import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';
import { isArea, type Area } from '../config/roles.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import type { SafeUser } from './auth.service.js';

/**
 * API keys — B3.2's "Integrations & API" section.
 *
 * ─── A KEY IS ITS OWNER, OPTIONALLY NARROWED ──────────────────────────
 * A request authenticated by key checks `canAccessArea` against the OWNING
 * user's role, exactly like a browser session does. A key may additionally
 * carry `scopes`, which can only ever REMOVE areas from that answer — the
 * guard is an intersection (see `requireArea`), never a replacement.
 *
 * That ordering is the whole safety property: a scope cannot grant what the
 * owner lacks, so a key is never an escalation path, and a scoped key is safe
 * to hand to a partner because it cannot reach past the areas it names.
 * `scopes: null` means "no narrowing", which is how every key issued before
 * this existed still behaves.
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
  purpose: string;
  recipient: string;
  keyPreview: string;
  /** Null means "everything its owner can reach" — see the schema's note. */
  scopes: readonly Area[] | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Every LIVE key for a user, newest-first — same "gone once revoked, not
 * marked dead in place" convention `session.service.ts` uses. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const rows = await prisma.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, purpose: true, recipient: true, keyPreview: true, scopes: true, lastUsedAt: true, createdAt: true },
  });

  return rows.map((row) => ({
    ...row,
    scopes: parseScopes(row.scopes),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface CreatedApiKey {
  id: string;
  name: string;
  purpose: string;
  recipient: string;
  /** The areas this key may reach, or null for "everything its owner can". */
  scopes: readonly Area[] | null;
  /** Plaintext, returned exactly once — same one-time-reveal contract as a
   * courier access code, password-reset token, or 2FA backup code. */
  key: string;
}

const MAX_LIVE_KEYS_PER_USER = 20;

export async function createApiKey(
  userId: string,
  name: string,
  purpose: string,
  recipient: string,
  /**
   * Omitted or null means "no narrowing". An EMPTY array is rejected rather
   * than stored: a key that may reach nothing is not a useful credential, and
   * silently treating it as "everything" would be the dangerous reading.
   */
  scopes?: readonly Area[] | null,
): Promise<CreatedApiKey> {
  if (scopes !== undefined && scopes !== null && scopes.length === 0) {
    throw AppError.badRequest('Choose at least one area for this key, or leave it unscoped', {
      field: 'scopes',
    });
  }
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
      purpose,
      recipient,
      keyHash: hashKey(plain),
      keyPreview: previewOf(plain),
      scopes: scopes ? scopes.join(',') : null,
    },
    select: { id: true, name: true, purpose: true, recipient: true, scopes: true },
  });

  return { ...row, scopes: parseScopes(row.scopes), key: plain };
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
export interface AuthenticatedApiKey {
  user: SafeUser;
  /**
   * The areas this key may reach, or `null` for "whatever the owner can".
   *
   * Returned alongside the user rather than folded into it: `SafeUser` is the
   * shape a SESSION produces too, and a session has no scope. Putting a
   * key-only concept on it would mean every session-authenticated request
   * carried a field that is meaningless there.
   */
  scopes: readonly Area[] | null;
}

/**
 * Parse the stored comma-separated list.
 *
 * Unknown entries are DROPPED rather than tolerated: an area that was renamed
 * or removed must grant nothing. Dropping can only ever narrow the key, which
 * is the safe direction. An empty result is still a real (empty) scope — it is
 * not the same as `null`, and must not collapse into "full access".
 */
function parseScopes(raw: string | null): readonly Area[] | null {
  if (raw === null) return null;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => isArea(entry));
}

export async function authenticateApiKey(plainKey: string): Promise<AuthenticatedApiKey | null> {
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

  return { user: safe, scopes: parseScopes(row.scopes) };
}
