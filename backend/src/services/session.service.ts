import { prisma } from '../db/prisma.js';

/**
 * Sessions & devices.
 *
 * ─── HOW THIS RELATES TO `tokenVersion` ──────────────────────────────
 * `tokenVersion` (auth.service.ts) answers "is ANY token this user holds
 * still valid" with one integer, checked with no extra query on every
 * request. It cannot answer "is THIS ONE login — from three days ago, on
 * this phone — still valid," which needs a row per login to point at. Both
 * mechanisms stay: a full sign-out-everywhere is still one `tokenVersion`
 * bump (cheaper than rewriting every session row), and killing one device is
 * one `Session.revokedAt` write. `authenticate` checks both.
 *
 * ─── WHY `userAgent`/`ip` ARE NEVER TRUSTED FOR A DECISION ────────────
 * Both are attacker-controlled free text (or, for `ip`, only as honest as
 * Express's `trust proxy` setting — see audit.service.ts's identical note).
 * They are stored and DISPLAYED so a person can recognise "that's my phone"
 * or "I don't recognise that," never read back into an authorization check.
 */

const MAX_USER_AGENT_LENGTH = 255;

/** How stale `lastSeenAt` may be before a request bothers updating it.
 * Writing on every single authenticated request would turn "list my
 * sessions" into a write-heavy endpoint for precision nobody needs down to
 * the second. */
const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60_000;

export interface SessionContext {
  userAgent?: string | null | undefined;
  ip?: string | null | undefined;
}

/**
 * Start tracking a new login. Called once per issued token — `login()` and
 * the self-service password-change route, both of which mint a fresh token.
 *
 * Takes plain values rather than `Request` directly: `login()` is called
 * from test suites with no HTTP request at all, and degrading to a session
 * with null context is the right behaviour there — context is the least
 * important part of a session row, never worth failing the login over.
 */
export async function createSession(
  userId: string,
  context: SessionContext = {},
): Promise<{ id: string }> {
  const session = await prisma.session.create({
    data: {
      userId,
      userAgent: context.userAgent ? context.userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
      ip: context.ip ?? null,
    },
    select: { id: true },
  });

  return session;
}

/**
 * True when the session is still live: exists, belongs to the claimed user,
 * and has not been individually revoked.
 *
 * Deliberately does NOT check `tokenVersion` — `getAuthenticatedUser` already
 * does, against the `User` row itself, and duplicating it here would be two
 * sources of truth for the same fact.
 */
export async function isSessionLive(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true },
  });

  return session !== null && session.userId === userId && session.revokedAt === null;
}

/**
 * Opportunistically refresh `lastSeenAt`. Fire-and-forget by design, same
 * shape as `audit()`: a failed heartbeat write must not fail the request it
 * rides on, and the caller does not wait for it.
 */
export function touchSession(sessionId: string): void {
  void prisma.session
    .updateMany({
      where: {
        id: sessionId,
        lastSeenAt: { lt: new Date(Date.now() - LAST_SEEN_UPDATE_INTERVAL_MS) },
      },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => {
      // Silently dropped, deliberately. Losing one heartbeat update is
      // invisible to the user and not worth a log line on every occurrence —
      // unlike audit.service.ts's writes, nothing here is evidence.
    });
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** Every LIVE session for a user, newest-first. Revoked sessions are not
 * shown — once killed, a device is gone from the list, not marked dead in
 * place, matching how a real "sign out this device" feature reads. */
export async function listSessions(userId: string): Promise<SessionSummary[]> {
  const rows = await prisma.session.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
  });

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}

/**
 * Revoke exactly one session — the actual point of this whole feature: kill
 * one device without touching any other.
 *
 * Scoped to `userId` in the WHERE clause, not just the session id: without
 * this, the id alone (a guessable-format cuid, not a secret) would let
 * anyone revoke anyone else's session by id. Ownership is not optional here.
 */
export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
