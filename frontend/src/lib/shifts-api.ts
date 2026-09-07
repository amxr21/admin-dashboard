import { apiFetch } from '@/lib/api';

/**
 * Shifts — a period of work (F6).
 *
 * Distinct from a session: a session is what the system recorded about your
 * activity, a shift is what YOU declared about your working day.
 */

export interface ShiftPerson {
  id: string;
  name: string | null;
  email: string;
}

export interface Shift {
  id: string;
  startedAt: string;
  /** Null means STILL OPEN — the one source of truth for "on now". */
  endedAt: string | null;
  /** What the times were before a manager corrected them. Null = never edited. */
  originalStartedAt: string | null;
  originalEndedAt: string | null;
  editReason: string | null;
  editedAt: string | null;
  note: string | null;
  user: ShiftPerson;
  branch: { id: string; name: string };
  openedBy: ShiftPerson;
  editedBy: ShiftPerson | null;
  /** Whether the recorded times were corrected. The UI says so rather than
   *  presenting edited hours as though they were clocked. */
  wasEdited: boolean;
}

/** My open shift, or null. */
export async function fetchMyShift(): Promise<Shift | null> {
  const result = await apiFetch<{ shift: Shift | null }>('/shifts/me');
  return result.shift;
}

export async function startShift(input: { note?: string; forUserId?: string } = {}): Promise<Shift> {
  const result = await apiFetch<{ shift: Shift }>('/shifts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.shift;
}

export async function endShift(id: string, note?: string): Promise<Shift> {
  const result = await apiFetch<{ shift: Shift }>(`/shifts/${id}/end`, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
  return result.shift;
}

export interface ShiftListResult {
  shifts: Shift[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchShifts(
  params: { page?: number; pageSize?: number; userId?: string; open?: boolean; from?: string; to?: string } = {},
): Promise<ShiftListResult> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.userId) query.set('userId', params.userId);
  if (params.open) query.set('open', 'true');
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);

  const suffix = query.toString();
  return apiFetch<ShiftListResult>(`/shifts${suffix ? `?${suffix}` : ''}`);
}

/** Correct the recorded times. A reason is required — an edited timesheet
 *  with no stated reason defeats the point of keeping the original. */
export async function editShift(
  id: string,
  input: { startedAt?: string; endedAt?: string | null; reason: string },
): Promise<Shift> {
  const result = await apiFetch<{ shift: Shift }>(`/shifts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return result.shift;
}

export interface ShiftSummary {
  shift: Shift;
  /**
   * Audited WRITES in the window. Reads are not audited, so this is "what
   * they changed", never "how busy they were" — the UI has to say so rather
   * than let a big number imply the second reading.
   */
  totalActions: number;
  byAction: { action: string; count: number }[];
  recent: {
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    createdAt: string;
  }[];
}

export async function fetchShiftSummary(id: string): Promise<ShiftSummary> {
  return apiFetch<ShiftSummary>(`/shifts/${id}/summary`);
}
