import { AuditOutcome } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { listAudit, type AuditListParams } from './audit.service.js';

/**
 * Who signed in, when, from where — and who tried and failed.
 *
 * ─── NO NEW WRITE PATH, AND NO NEW TABLE ─────────────────────────────
 * Every event this reports has been recorded since the audit trail was built:
 * `auth.route.ts` already writes `auth.login.succeeded`, `auth.login.failed`
 * (with the attempted email and a reason), both 2FA outcomes, `auth.logout`
 * and `auth.session.revoked`. `AuditLog` is even indexed `[actorId, createdAt]`
 * for exactly this query.
 *
 * What was missing was a SURFACE. The events were reachable only by knowing to
 * open /admin/audit and filter `entity: 'auth'` by hand, which means in
 * practice nobody ever saw them — and a burst of failed logins against one
 * account, the single signal worth watching, was invisible.
 *
 * So this is a read-model over existing rows. Nothing here writes, which also
 * means it cannot drift from the trail it reports: there is only one record of
 * a sign-in and both surfaces read it.
 *
 * ─── WHY A FAILED ATTEMPT HAS NO ACTOR ───────────────────────────────
 * A failed login has not proved who anyone is, so `actorId` is null and the
 * attempted email lives in `changes.email` instead. That is why the per-user
 * queries below cannot simply filter on `actorId` and expect failures to come
 * with them — see `countRecentFailuresByEmail`.
 */

/** The events that constitute "someone tried to get in", newest concepts last. */
export const LOGIN_HISTORY_ACTIONS = [
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.login.2fa-verified',
  'auth.login.2fa-failed',
  'auth.logout',
  'auth.session.revoked',
] as const;

/** Only the two that mean "a credential was rejected". A logout is not a
 *  failure, and a revoked session is an administrative act, not an attempt. */
const FAILURE_ACTIONS = ['auth.login.failed', 'auth.login.2fa-failed'] as const;

export interface LoginHistoryParams
  extends Pick<AuditListParams, 'page' | 'pageSize' | 'cursor' | 'from' | 'to'> {
  /** One person's history. Matches the actor on successes AND the attempted
   *  email on failures, so a user's own failed attempts are not lost. */
  userId?: string;
  /** Narrow to failures only — the security-review query. */
  outcome?: AuditOutcome;
}

/** The history itself. See the note inside on why one branch delegates to
 *  `listAudit` and the per-user branch cannot. */
export async function listLoginHistory(params: LoginHistoryParams) {
  const { userId, outcome, ...rest } = params;

  // Filtering by user has to reach FAILURES too, and those carry no actorId —
  // a rejected login has not proved who was trying. The attempted email is
  // the only link, and it lives in a JSON column, which `listAudit`'s shared
  // where-builder cannot express without every other caller paying for it.
  //
  // So a per-user query is answered here directly, and everything else is
  // delegated to `listAudit` (which owns cursor paging — this table is
  // append-only, and offset paging over it silently re-shows and skips rows
  // as entries land mid-read).
  if (!userId) {
    return listAudit({
      ...rest,
      actions: [...LOGIN_HISTORY_ACTIONS],
      ...(outcome ? { outcome } : {}),
    });
  }

  const email = await emailFor(userId);
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);

  const where = {
    action: { in: [...LOGIN_HISTORY_ACTIONS] },
    ...(outcome ? { outcome } : {}),
    ...dateWindow(params),
    OR: [
      { actorId: userId },
      // Failures, matched by the email that was attempted.
      ...(email
        ? [{ actorId: null, changes: { path: '$.email', equals: email } }]
        : []),
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    // `entries`, matching `listAudit`'s own key — the two branches of this
    // function must return ONE shape, or every caller needs to know which
    // branch it took, which is exactly the bug this naming avoids.
    entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * How many times this account has been rejected recently (F2.4).
 *
 * Deliberately a SIGNAL, not an enforcement: this app already has a lockout
 * concept (`LOGIN_MAX_ATTEMPTS`, cleared by a password reset), and adding a
 * second, differently-triggered lockout path would be a real footgun — two
 * mechanisms disagreeing about whether an account is locked is worse than
 * either alone. Surface the number; leave the decision to a person.
 *
 * Counted by ATTEMPTED EMAIL, not actor: a failed login never proves who was
 * trying, so `actorId` is null on exactly the rows that matter here.
 */
export async function countRecentFailuresByEmail(
  emails: string[],
  sinceHours = 24,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (emails.length === 0) return counts;

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  // The email is inside a JSON column, so this cannot be a `groupBy` — the
  // rows are read and tallied in memory. Bounded by `since` and by the take
  // below so a noisy period cannot turn a staff list into an unbounded read.
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: [...FAILURE_ACTIONS] },
      outcome: AuditOutcome.DENIED,
      createdAt: { gte: since },
    },
    select: { changes: true },
    take: 5000,
  });

  const wanted = new Set(emails.map((value) => value.toLowerCase()));

  for (const row of rows) {
    const email = emailIn(row.changes)?.toLowerCase();
    if (!email || !wanted.has(email)) continue;
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }

  return counts;
}

/** The attempted email recorded on a failed-login entry, if it is there. */
function emailIn(changes: unknown): string | null {
  if (typeof changes !== 'object' || changes === null) return null;
  const value = (changes as { email?: unknown }).email;
  return typeof value === 'string' ? value : null;
}

function dateWindow(params: LoginHistoryParams) {
  if (!params.from && !params.to) return {};
  return {
    createdAt: {
      ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
      ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
    },
  };
}

async function emailFor(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email;
}

export interface StaffSessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * Another user's live sessions (F2.1).
 *
 * `session.service.ts`'s `listSessions` is deliberately self-scoped — it backs
 * "my devices" and takes the caller's own id. This is the admin view, so the
 * rank check lives at the route, where the actor is known.
 */
export async function listSessionsFor(userId: string): Promise<StaffSessionSummary[]> {
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

/** Last-seen across all of a user's live sessions (F2.5) — "who is actually
 *  using this dashboard", which the staff list could never answer. */
export async function lastSeenFor(userIds: string[]): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  if (userIds.length === 0) return seen;

  const rows = await prisma.session.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds }, revokedAt: null },
    _max: { lastSeenAt: true },
  });

  for (const row of rows) {
    if (row._max.lastSeenAt) seen.set(row.userId, row._max.lastSeenAt.toISOString());
  }

  return seen;
}

/** Revoke one of ANOTHER user's sessions (F2.3). Ownership is still in the
 *  WHERE clause: a session id is a cuid, not a secret, so the pairing must be
 *  proven rather than assumed from the id alone. */
export async function revokeSessionFor(userId: string, sessionId: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count > 0;
}

/**
 * Sign a user out everywhere.
 *
 * Bumps `tokenVersion` as well as revoking the session rows: the rows govern
 * the "my devices" list, but the token version is what makes an already-issued
 * JWT stop verifying. Revoking rows alone would leave live tokens working
 * until they expired, which is precisely the case this exists for.
 */
export async function signOutEverywhere(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }),
  ]);
}
