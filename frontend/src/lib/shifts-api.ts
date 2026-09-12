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

export type ShiftApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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

  /**
   * A RECORD, not a gate (O9.19) — a shift starts and the till works
   * immediately regardless of this value. A manager confirms afterward (or
   * while it's still running) that it's legitimate.
   */
  approvalStatus: ShiftApprovalStatus;
  approvedAt: string | null;
  approvedBy: ShiftPerson | null;
  /** Required on REJECTED, same discipline as a return's rejection reason. */
  approvalNote: string | null;

  /**
   * The till (O5.3), as 2dp strings. NULL means this shift had NO drawer —
   * most of them, since a picker never opens one. That is a different fact
   * from a float of zero, and it decides whether closing asks for a count.
   */
  openingFloat: string | null;
  closingCount: string | null;
  /** Negative is short, positive is over. Null until the till is closed. */
  variance: string | null;
}

/** My open shift, or null. */
export async function fetchMyShift(): Promise<Shift | null> {
  const result = await apiFetch<{ shift: Shift | null }>('/shifts/me');
  return result.shift;
}

export async function startShift(
  input: { note?: string; forUserId?: string; openingFloat?: string } = {},
): Promise<Shift> {
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
  params: {
    page?: number;
    pageSize?: number;
    userId?: string;
    open?: boolean;
    /** A manager's pending-approval queue (O9.19) when set to PENDING. */
    approvalStatus?: ShiftApprovalStatus;
    from?: string;
    to?: string;
  } = {},
): Promise<ShiftListResult> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.userId) query.set('userId', params.userId);
  if (params.open) query.set('open', 'true');
  if (params.approvalStatus) query.set('approvalStatus', params.approvalStatus);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);

  const suffix = query.toString();
  return apiFetch<ShiftListResult>(`/shifts${suffix ? `?${suffix}` : ''}`);
}

/** Confirm a shift is legitimate (O9.19). See `Shift.approvalStatus`'s own
 *  note — not a gate, a follow-up record. */
export async function approveShift(id: string): Promise<Shift> {
  const result = await apiFetch<{ shift: Shift }>(`/shifts/${id}/approve`, { method: 'POST' });
  return result.shift;
}

/** Same shape as approving, opposite outcome. A reason is required. */
export async function rejectShift(id: string, note: string): Promise<Shift> {
  const result = await apiFetch<{ shift: Shift }>(`/shifts/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
  return result.shift;
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

/**
 * Foreign cash in the drawer, counted in its OWN units (URG-034).
 *
 * Never converted into the store currency: the owner's rule is that a
 * shortfall must stay distinguishable from the rate moving during the shift,
 * and one combined "expected" figure makes those two indistinguishable.
 * `expected` is what should physically remain — taken minus change given
 * back, both in this currency.
 */
export interface TenderCurrencyTakings {
  currency: string;
  expected: string;
}

export interface ShiftTakings {
  byMethod: { method: string; total: string }[];
  /** Empty on the overwhelming majority of installs — nothing is accepted
   *  beyond the store currency until a rate is configured above zero. */
  byTenderCurrency: TenderCurrencyTakings[];
  /** Raw cash SALES only — card takings never were in the drawer, and this
   *  does NOT account for a cash drop or payout since (O9 Tier 4). For
   *  "what should physically be in the drawer right now", read
   *  `expectedCash` instead. */
  cash: string;
  /** What should physically be in the drawer, given cash sales minus any
   *  cash drops/payouts logged this shift — the figure to compare a count
   *  against. Was `cash` itself before O9 Tier 4 added drops/payouts; kept
   *  as a separate field rather than changing what `cash` means, since a
   *  caller wanting raw sales (not the drawer figure) still needs it. */
  expectedCash: string;
}

export async function fetchShiftTakings(id: string): Promise<ShiftTakings> {
  return apiFetch<ShiftTakings>(`/shifts/${id}/takings`);
}

export interface TillCloseResult {
  shift: Shift;
  /** Opening float plus cash taken. */
  expected: string;
  counted: string;
  /** Negative is short, positive is over. Recorded either way — a till that
   *  refuses an inconvenient count stops being counted honestly. */
  variance: string;
}

export async function closeTill(
  id: string,
  closingCount: string,
  note?: string,
): Promise<TillCloseResult> {
  return apiFetch<TillCloseResult>(`/shifts/${id}/close-till`, {
    method: 'POST',
    body: JSON.stringify({ closingCount, ...(note ? { note } : {}) }),
  });
}

/**
 * A drawer event with no sale behind it (O9 Tier 4) — a no-sale open, a cash
 * drop, or a payout. Only the person whose shift it is may log one; only
 * belongs to an OPEN shift.
 */
export type TillEventType = 'NO_SALE' | 'CASH_DROP' | 'PAYOUT';

export interface TillEvent {
  id: string;
  type: TillEventType;
  /** Null for NO_SALE, which moves nothing. */
  amount: string | null;
  note: string | null;
  createdAt: string;
}

export async function recordTillEvent(
  shiftId: string,
  input: { type: TillEventType; amount?: string; note?: string },
): Promise<TillEvent> {
  const result = await apiFetch<{ event: TillEvent }>(`/shifts/${shiftId}/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.event;
}

export async function fetchTillEvents(shiftId: string): Promise<TillEvent[]> {
  const result = await apiFetch<{ events: TillEvent[] }>(`/shifts/${shiftId}/events`);
  return result.events;
}

/**
 * The X/Z report (O9 Tier 4) — the printable end-of-shift summary. Same
 * shape whether the shift is still open (an X report, `isFinal: false`) or
 * already closed (a Z report, `isFinal: true`); the caller decides which it
 * is by asking before or after `closeTill`, not this type.
 */
export interface TillReport {
  shift: Shift;
  byMethod: { method: string; total: string }[];
  /** Per-currency foreign cash (URG-034) — see `TenderCurrencyTakings`. Each
   *  currency is counted separately at close rather than converted. */
  byTenderCurrency: TenderCurrencyTakings[];
  cash: string;
  expectedCash: string;
  noSaleCount: number;
  cashDropTotal: string;
  payoutTotal: string;
  events: TillEvent[];
  isFinal: boolean;
}

export async function fetchTillReport(shiftId: string): Promise<TillReport> {
  return apiFetch<TillReport>(`/shifts/${shiftId}/report`);
}
