import type { Request } from 'express';

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

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  /** Only what changed. `{ status: { from: 'PENDING', to: 'CONFIRMED' } }`. */
  changes?: Record<string, unknown> | null;
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
  const user = req.user;

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
        requestId: req.requestId ?? null,
      },
    })
    .catch((error: unknown) => {
      // The one place a swallowed error is correct — but it is still LOUD in
      // the logs, because a silently broken audit trail is worse than none.
      req.log.error({
        event: 'audit.write.failed',
        action: entry.action,
        entity: entry.entity,
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
  entity?: string;
  entityId?: string;
  actorId?: string;
}

/** Read the trail. There is deliberately no write, update or delete route. */
export async function listAudit(params: AuditListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));

  const where = {
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
