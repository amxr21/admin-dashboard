import { apiDownload, apiFetch } from '@/lib/api';

/**
 * Client for `/api/v1/audit` — read-only by design (see audit.route.ts).
 *
 * `changes` is untyped on purpose: it is a field-level diff produced by
 * whichever service wrote the entry (`{ status: { from, to } }`,
 * `{ price: { from, to } }`, …), and the shape is only ever rendered, never
 * interpreted, so there is nothing to gain from a narrower type here.
 */

/** Mirrors the backend `AuditOutcome` enum. */
export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'ERROR';

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  /** `DENIED` is a refused attempt — nothing was changed. */
  outcome: AuditOutcome;
  requestId: string | null;
  /** Null where no honest answer exists (e.g. no forwarding header). */
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/**
 * Offset mode. `total`/`page`/`totalPages` are only present in this mode —
 * counting an unbounded, append-only table on every cursor page is exactly the
 * cost cursor mode exists to avoid.
 */
export interface AuditListResult {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Present in both modes, so a caller can switch without a second request. */
  nextCursor: string | null;
}

/** Cursor mode. `nextCursor === null` means this was the last page. */
export interface AuditCursorResult {
  entries: AuditEntry[];
  pageSize: number;
  nextCursor: string | null;
}

export interface AuditListParams {
  page?: number;
  pageSize?: number;
  entity?: string;
  entityId?: string;
  actorId?: string;
  /** Exact action name, e.g. every `product.deleted`. */
  action?: string;
  outcome?: AuditOutcome;
  /** Every entry from one request, so a single action's effects read together. */
  requestId?: string;
  /** Calendar dates, `YYYY-MM-DD`, both inclusive. */
  from?: string;
  to?: string;
}

/** Same filters, but paged by cursor rather than offset. */
export type AuditCursorParams = Omit<AuditListParams, 'page'> & { cursor?: string };

function toQuery(params: object): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return query.toString();
}

/**
 * Offset-paged read. Kept as-is for callers that only want the newest few
 * entries — `dashboard-overview.tsx` asks for `{page: 1, pageSize: 6}` and is
 * correct with offset, since page 1 of a descending list cannot drift.
 */
export async function fetchAudit(params: AuditListParams = {}): Promise<AuditListResult> {
  return apiFetch<AuditListResult>(`/audit?${toQuery(params)}`);
}

/**
 * Cursor-paged read, for walking the whole trail.
 *
 * Entries are written while a reviewer reads, so offset paging over this table
 * re-shows rows on page 2 that were already on page 1 and silently skips
 * others. Pass the previous response's `nextCursor` to continue.
 */
export async function fetchAuditPage(
  params: AuditCursorParams = {},
): Promise<AuditCursorResult> {
  return apiFetch<AuditCursorResult>(`/audit?${toQuery(params)}`);
}

export async function fetchAuditEntities(): Promise<string[]> {
  return apiFetch<string[]>('/audit/entities');
}

/** Distinct action names present in the log, for the "show me all deletes" filter. */
export async function fetchAuditActions(): Promise<string[]> {
  return apiFetch<string[]>('/audit/actions');
}

/**
 * Download the current filter as CSV.
 *
 * Same endpoint and same filters as the table — only the serialisation differs,
 * so the file can never describe a different set of rows than the screen it was
 * exported from. Capped server-side at 10,000 rows.
 */
export async function exportAuditCsv(params: AuditListParams = {}): Promise<void> {
  await apiDownload(`/audit?${toQuery({ ...params, format: 'csv' })}`, 'audit-log.csv');
}
