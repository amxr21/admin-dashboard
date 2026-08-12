import type { Request } from 'express';
import { AuditOutcome } from '@prisma/client';

import { prisma } from '../db/prisma.js';

/**
 * Who changed what.
 *
 * ─── WHY THIS NEVER THROWS ───────────────────────────────────────────
 * A failed audit write must not fail the operation it was describing. If the
 * audit table is full, or its connection drops, the customer's order still has
 * to save — losing the record of a change is bad, losing the change is worse,
 * and an audit system that can take the app down will be removed by whoever is
 * on call at 3am.
 *
 * So every failure is swallowed and logged. That is a deliberate trade, and it
 * means the trail is best-effort by design rather than by accident.
 *
 * ─── WHAT IS RECORDED, AND WHAT IS NOT ───────────────────────────────
 * Changed FIELDS, never whole rows. A full snapshot of a customer copies their
 * name, email and phone into a table that outlives the record itself — and an
 * audit log is exactly the table nobody thinks to include in a deletion
 * request.
 *
 * Sensitive values are replaced with a marker rather than omitted, because
 * "the password changed" is the fact worth keeping and the value never is.
 */

/** Never recorded, whatever the caller passes. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'accessCode',
  'accessCodeHash',
  'token',
  'tokenVersion',
]);

const REDACTED = '[redacted]';

/** Longest a single recorded value may be, so one blob cannot fill the table. */
const MAX_VALUE_LENGTH = 500;

/** A user-agent is attacker-controlled free text; the column is VarChar(255). */
const MAX_USER_AGENT_LENGTH = 255;

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  /** Only what changed. `{ status: { from: 'PENDING', to: 'CONFIRMED' } }`. */
  changes?: Record<string, unknown> | null;
  /** Defaults to SUCCESS — the overwhelmingly common case. */
  outcome?: AuditOutcome;
  /**
   * Actor override, for the one case where `req.user` cannot be right: a
   * successful LOGIN. Nothing authenticated that request — the request *is*
   * the authentication — so the actor is only known from its result. Cloning
   * the request to fake `req.user` would be worse: Express's request is
   * prototype-based and a spread of it silently loses `get`, `ip` and more.
   */
  actor?: { id: string; email: string; role: string } | null;
}

/**
 * Where the request came from, as far as can be honestly determined.
 *
 * `req.ip` already respects Express's `trust proxy` setting, so this reads the
 * forwarded address only when the app has been told its proxy is trustworthy.
 * Reading `x-forwarded-for` directly instead would let any client set its own
 * apparent IP by sending the header — which would put a forged address into
 * the one table meant to be evidence.
 */
function requestContext(req: Request) {
  // Defensive on purpose. `audit()` promises never to fail the operation it
  // describes, and that promise has to hold BEFORE the promise chain too —
  // anything thrown while assembling the row would escape the `.catch()` below
  // and propagate into the caller. Context is the least important part of an
  // entry, so it degrades to null rather than costing the entry or the write
  // it was describing.
  let userAgent: string | undefined;
  let ip: string | undefined;

  try {
    userAgent = typeof req.get === 'function' ? req.get('user-agent') : undefined;
    ip = req.ip;
  } catch {
    // Left null below.
  }

  return {
    ip: ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
    requestId: req.requestId ?? null,
  };
}

function redact(changes: Record<string, unknown> | null | undefined): unknown {
  if (!changes) return null;

  return Object.fromEntries(
    Object.entries(changes).map(([key, value]) => {
      if (REDACTED_FIELDS.has(key)) return [key, REDACTED];

      const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);

      // Truncated rather than dropped: knowing a long description changed is
      // more useful than a gap where the field should be.
      return [
        key,
        typeof text === 'string' && text.length > MAX_VALUE_LENGTH
          ? `${text.slice(0, MAX_VALUE_LENGTH)}…`
          : value,
      ];
    }),
  );
}

/**
 * Record an entry. Fire-and-forget by design — see the note above.
 *
 * Takes the request so the actor and requestId come from one place rather than
 * being threaded through every service signature.
 */
export function audit(req: Request, entry: AuditEntry): void {
  const user = entry.actor ?? req.user;

  void prisma.auditLog
    .create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        actorId: user?.id ?? null,
        // Denormalised on purpose: the email is what a reviewer recognises, and
        // it has to survive the account being deleted.
        actorEmail: user?.email ?? null,
        actorRole: user?.role ?? null,
        changes: redact(entry.changes) as never,
        outcome: entry.outcome ?? AuditOutcome.SUCCESS,
        ...requestContext(req),
      },
    })
    .catch((error: unknown) => {
      // The one place a swallowed error is correct — but it is still LOUD in
      // the logs, because a silently broken audit trail is worse than none.
      const detail = {
        event: 'audit.write.failed',
        action: entry.action,
        entity: entry.entity,
        error: error instanceof Error ? error.message : String(error),
      };

      // Reaching for the logger must not itself become the unhandled rejection
      // that takes the process down when a caller passes a partial request.
      if (typeof req.log?.error === 'function') req.log.error(detail);
      // eslint-disable-next-line no-console
      else console.error(detail);
    });
}

/**
 * Record a refused attempt.
 *
 * ─── WHY DENIALS ARE WORTH A ROW ─────────────────────────────────────
 * A trail of successes answers "what changed". It cannot answer "who has been
 * probing the staff endpoints for a week", because nothing they did succeeded
 * and so nothing was written. Repeated denials are what an attack looks like
 * before it works, and what a mis-scoped role looks like for the person stuck
 * behind it — both worth seeing.
 *
 * `entity` is the area or resource that was refused rather than a table row:
 * a denied request often names no record at all, and inventing one would put
 * a fact in the trail that never happened.
 */
export function auditDenied(
  req: Request,
  entry: Omit<AuditEntry, 'outcome'>,
): void {
  audit(req, { ...entry, outcome: AuditOutcome.DENIED });
}

/**
 * Field-level diff, so callers record what actually changed.
 *
 * Comparing before/after rather than logging the whole payload means an
 * "update" that changed nothing produces no entry, and a reviewer reading the
 * trail sees decisions rather than noise.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of Object.keys(after)) {
    const from = before[key];
    const to = after[key];

    // JSON comparison so Dates and Decimals compare by value, not identity.
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[key] = { from, to };
    }
  }

  return changes;
}

export interface AuditListParams {
  page?: number;
  pageSize?: number;
  /**
   * Opaque cursor from a previous page's `nextCursor`. When present, `page` is
   * ignored — the two modes are mutually exclusive by design, see below.
   */
  cursor?: string;
  entity?: string;
  entityId?: string;
  actorId?: string;
  /** Exact match on the action name, e.g. every `product.deleted`. */
  action?: string;
  /** `DENIED` is the security-review query this exists for. */
  outcome?: AuditOutcome;
  /** All entries from one request, so a single action's effects read together. */
  requestId?: string;
  /** Inclusive. Calendar date `YYYY-MM-DD`, interpreted as that day's start UTC. */
  from?: string;
  /** Inclusive. Calendar date `YYYY-MM-DD`, interpreted as that day's END UTC —
   * a plain `lte` on the date string would exclude the whole day it names. */
  to?: string;
}

/**
 * Build the `where` clause shared by both pagination modes and by the export.
 *
 * Extracted so a filter can never mean one thing on screen and another in the
 * CSV a reviewer hands to an auditor.
 */
export function auditWhere(params: AuditListParams) {
  const createdAt =
    params.from || params.to
      ? {
          ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
          ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  return {
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
    ...(params.action ? { action: params.action } : {}),
    ...(params.outcome ? { outcome: params.outcome } : {}),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

/** Generic so the row's own fields survive — narrowing the parameter to
 * `{ createdAt: Date }` would erase everything else from the return type. */
function serialise<T extends { createdAt: Date }>(row: T) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Read the trail. There is deliberately no write, update or delete route.
 *
 * ─── TWO PAGINATION MODES, ON PURPOSE ────────────────────────────────
 * Offset (`page`/`pageSize`) is kept because callers that only ever want the
 * newest few entries — the dashboard's recent-activity widget asks for
 * `{page: 1, pageSize: 6}` — are correct with it and gain nothing from a
 * cursor. Removing it would break them for no benefit.
 *
 * Cursor mode exists because this table is append-only and unbounded, and
 * offset paging over it is wrong in a way that is easy to miss: entries are
 * written while a reviewer reads. Every new row shifts the window, so page 2
 * re-shows rows already seen on page 1 and silently skips others. `skip` also
 * degrades on a table that only grows.
 *
 * The cursor is the row id, applied with `orderBy: [createdAt desc, id desc]`
 * — id breaks ties so two entries written in the same millisecond can never
 * straddle a page boundary and be shown twice or not at all.
 */
export async function listAudit(params: AuditListParams) {
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const where = auditWhere(params);

  const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

  if (params.cursor) {
    // One extra row is fetched purely to answer "is there another page?"
    // without a second query — it is dropped before returning.
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy,
      cursor: { id: params.cursor },
      skip: 1,
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const entries = hasMore ? rows.slice(0, pageSize) : rows;

    return {
      entries: entries.map(serialise),
      // Deliberately no `total` in cursor mode: counting an unbounded table on
      // every page is the cost this mode exists to avoid, and a total that is
      // already stale by the time it renders is not worth paying for.
      pageSize,
      nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
    };
  }

  const page = Math.max(1, params.page ?? 1);

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map(serialise),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    // Offered even in offset mode so a caller can switch over without a second
    // round trip — the dashboard widget simply ignores it.
    nextCursor: rows.length === pageSize ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

/** Distinct entity names actually present in the log, for a filter dropdown
 * that never offers a value returning zero rows. */
export async function listAuditEntities(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ['entity'],
    select: { entity: true },
    orderBy: { entity: 'asc' },
  });

  return rows.map((row) => row.entity);
}

/**
 * Rows for a CSV export of the current filter.
 *
 * Capped rather than unbounded: this table only grows, and an unfiltered export
 * would try to stream millions of rows through one request. The cap is applied
 * newest-first and the caller is TOLD when it truncated (`truncated: true`) —
 * a short export that silently claims to be complete is the failure mode worth
 * avoiding in an evidence trail.
 */
export const AUDIT_EXPORT_LIMIT = 10_000;

export async function listAuditForExport(params: AuditListParams) {
  const where = auditWhere(params);

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_EXPORT_LIMIT + 1,
  });

  const truncated = rows.length > AUDIT_EXPORT_LIMIT;

  return {
    rows: (truncated ? rows.slice(0, AUDIT_EXPORT_LIMIT) : rows).map(serialise),
    truncated,
  };
}

/** Distinct action names actually present, for the "show me all deletes" filter. */
export async function listAuditActions(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ['action'],
    select: { action: true },
    orderBy: { action: 'asc' },
  });

  return rows.map((row) => row.action);
}
