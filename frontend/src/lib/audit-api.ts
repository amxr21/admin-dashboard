import { apiFetch } from '@/lib/api';

/**
 * Client for `/api/v1/audit` — read-only by design (see audit.route.ts).
 *
 * `changes` is untyped on purpose: it is a field-level diff produced by
 * whichever service wrote the entry (`{ status: { from, to } }`,
 * `{ price: { from, to } }`, …), and the shape is only ever rendered, never
 * interpreted, so there is nothing to gain from a narrower type here.
 */

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditListResult {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditListParams {
  page?: number;
  pageSize?: number;
  entity?: string;
  entityId?: string;
  actorId?: string;
  /** Calendar dates, `YYYY-MM-DD`, both inclusive. */
  from?: string;
  to?: string;
}

export async function fetchAudit(params: AuditListParams = {}): Promise<AuditListResult> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  return apiFetch<AuditListResult>(`/audit?${query.toString()}`);
}

export async function fetchAuditEntities(): Promise<string[]> {
  return apiFetch<string[]>('/audit/entities');
}
