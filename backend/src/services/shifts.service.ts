import { Prisma, ShiftApprovalStatus, StaffRole, TillEventType } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { outranks } from '../config/roles.js';
import { defaultBranchId } from './inventory.service.js';
import { isBusinessWideRole } from './branch-roles.service.js';

/**
 * Shifts — periods of WORK (F6).
 *
 * ─── A SHIFT IS NOT A SESSION ────────────────────────────────────────
 * The owner drew this line himself: a `Session` is the backlog of activity
 * inside the system, written BY the app when somebody signs in. A shift is
 * declared by the PERSON and describes their working day. A cashier can be
 * signed in all night without being on shift, and can be on shift while
 * signed in on somebody else's till, so neither can stand in for the other.
 *
 * ─── ONE OPEN SHIFT PER PERSON ───────────────────────────────────────
 * Enforced here rather than by a unique constraint, because "open" is
 * `endedAt IS NULL` and SQL cannot make that unique per user. Two open shifts
 * would make "who is on now" list somebody twice and "how long have they been
 * on" ambiguous — there would be no correct answer to pick between.
 */

const OPEN = { endedAt: null } as const;

export interface ShiftActor {
  id: string;
  role: StaffRole;
}

const SHIFT_SELECT = {
  id: true,
  startedAt: true,
  endedAt: true,
  originalStartedAt: true,
  originalEndedAt: true,
  editReason: true,
  editedAt: true,
  note: true,
  openingFloat: true,
  closingCount: true,
  variance: true,
  approvalStatus: true,
  approvedAt: true,
  approvalNote: true,
  user: { select: { id: true, name: true, email: true } },
  branch: { select: { id: true, name: true } },
  openedBy: { select: { id: true, name: true, email: true } },
  editedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
} as const;

type ShiftRow = Prisma.ShiftGetPayload<{ select: typeof SHIFT_SELECT }>;

function serialise(shift: ShiftRow) {
  return {
    ...shift,
    startedAt: shift.startedAt.toISOString(),
    endedAt: shift.endedAt?.toISOString() ?? null,
    originalStartedAt: shift.originalStartedAt?.toISOString() ?? null,
    originalEndedAt: shift.originalEndedAt?.toISOString() ?? null,
    editedAt: shift.editedAt?.toISOString() ?? null,
    approvedAt: shift.approvedAt?.toISOString() ?? null,
    // Money as 2dp strings, never numbers — the same rule as every other
    // amount that crosses this boundary. Null stays null: "no till" is a
    // different fact from "a float of zero".
    openingFloat: shift.openingFloat?.toFixed(2) ?? null,
    closingCount: shift.closingCount?.toFixed(2) ?? null,
    variance: shift.variance?.toFixed(2) ?? null,
    /** Whether a manager corrected the recorded times. The UI says so rather
     *  than showing edited hours as if they were clocked. */
    wasEdited: shift.editedAt !== null,
  };
}

/** The caller's own open shift, or null. Drives the shell's shift control. */
export async function getOpenShift(userId: string) {
  const shift = await prisma.shift.findFirst({
    where: { userId, ...OPEN },
    orderBy: { startedAt: 'desc' },
    select: SHIFT_SELECT,
  });

  return shift ? serialise(shift) : null;
}

/**
 * Which branch an unscoped shift-start should land on.
 *
 * `defaultBranchId()` refuses to guess once an install has more than one
 * business — right for an OWNER/DEVELOPER choosing where THEY are working,
 * wrong for a cashier or any other branch-scoped role, who has no "which
 * business" decision to make and no UI (the branch switcher) that requires
 * them to make one. That person is either assigned to exactly one branch via
 * `UserBranch`, in which case that IS the answer, or assigned to none, which
 * is a roster gap for an owner to fix, not something to fall back past.
 *
 * A business-wide role keeps going through `defaultBranchId()` — the
 * single-business shortcut still applies to them, and the ambiguous case is
 * exactly the one that error message is written for.
 */
async function resolveShiftBranchId(userId: string, actorRole: StaffRole): Promise<string | null> {
  if (isBusinessWideRole(actorRole)) return defaultBranchId();

  const assignments = await prisma.userBranch.findMany({
    where: { userId, branch: { isActive: true } },
    select: { branchId: true },
  });

  if (assignments.length === 1) return assignments[0]!.branchId;
  if (assignments.length > 1) {
    throw AppError.badRequest(
      'Select a branch — you work at more than one, so there is no single default to fall back to.',
      { field: 'branchId', reason: 'BRANCH_REQUIRED_MULTIPLE_ASSIGNMENTS' },
    );
  }

  // No roster row at all: fall back to the same single-business shortcut a
  // business-wide role gets, so a one-branch install with no explicit roster
  // (the common case before anyone has touched F8's staff assignment screen)
  // keeps working exactly as it did before per-branch roles existed.
  return defaultBranchId();
}

/**
 * Start a shift.
 *
 * `forUserId` lets a manager open one for somebody who forgot to clock in —
 * `openedById` records who actually did it, so the two are never conflated.
 * Opening for yourself is the ordinary case and needs no permission beyond
 * being signed in: clocking on is not a privileged act.
 */
export async function startShift(
  actor: ShiftActor,
  input: {
    branchId?: string | undefined;
    forUserId?: string | undefined;
    note?: string | undefined;
    /** Cash in the drawer at open (O5.3). Omitted for a shift with no till,
     *  which is most of them — a picker never opens a drawer. */
    openingFloat?: string | undefined;
  },
) {
  const userId = input.forUserId ?? actor.id;

  if (userId !== actor.id) {
    // Opening a shift FOR somebody else is a write about them, so it obeys
    // the same rank rule every other staff write does: nobody reaches upward.
    const subject = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!subject) throw AppError.notFound('Staff member not found');

    if (outranks(subject.role, actor.role)) {
      throw AppError.forbidden('You cannot modify someone with more access than you');
    }
  }

  const existing = await prisma.shift.findFirst({
    where: { userId, ...OPEN },
    select: { id: true },
  });

  if (existing) {
    // Not silently returning the existing one: the caller believes they are
    // starting work, and quietly handing back a shift that began hours ago
    // would report the wrong duration for the rest of the day.
    throw AppError.conflict('That person already has an open shift');
  }

  const branchId = input.branchId ?? (await resolveShiftBranchId(userId, actor.role));

  if (!branchId) {
    throw AppError.badRequest('No branch to record this shift against', {
      field: 'branchId',
      reason: 'NO_ACTIVE_BRANCH',
    });
  }

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, isActive: true },
  });

  if (!branch) {
    throw AppError.badRequest('Branch not found', {
      field: 'branchId',
      reason: 'BRANCH_NOT_FOUND',
    });
  }

  const shift = await prisma.shift.create({
    data: {
      userId,
      branchId,
      openedById: actor.id,
      startedAt: new Date(),
      ...(input.note ? { note: input.note } : {}),
      ...(input.openingFloat !== undefined
        ? { openingFloat: new Prisma.Decimal(input.openingFloat) }
        : {}),
    },
    select: SHIFT_SELECT,
  });

  return serialise(shift);
}

/**
 * End a shift.
 *
 * Anyone may end their own. Ending somebody ELSE's is the "they went home
 * without clocking out" case and obeys the rank rule, like opening one.
 */
export async function endShift(actor: ShiftActor, shiftId: string, note?: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, userId: true, endedAt: true, user: { select: { role: true } } },
  });

  if (!shift) throw AppError.notFound('Shift not found');

  if (shift.endedAt !== null) {
    throw AppError.badRequest('That shift has already ended');
  }

  if (shift.userId !== actor.id && outranks(shift.user.role, actor.role)) {
    throw AppError.forbidden('You cannot modify someone with more access than you');
  }

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: { endedAt: new Date(), ...(note ? { note } : {}) },
    select: SHIFT_SELECT,
  });

  return serialise(updated);
}

/**
 * Correct a shift's recorded times.
 *
 * ─── THE ORIGINAL IS KEPT, NOT OVERWRITTEN ───────────────────────────
 * The owner's decision: a manager may fix a forgotten clock-in, and the
 * correction stays VISIBLE. `originalStartedAt`/`originalEndedAt` hold what
 * was recorded before the FIRST edit and are never rewritten by a second one
 * — otherwise a manager could launder an edit by editing twice. Same
 * discipline as `StockMovement`: a timesheet that can be silently rewritten
 * is worth less as a record, and these are hours people may be paid for.
 */
export async function editShift(
  actor: ShiftActor,
  shiftId: string,
  input: { startedAt?: string | undefined; endedAt?: string | null | undefined; reason: string },
) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      endedAt: true,
      originalStartedAt: true,
      originalEndedAt: true,
      user: { select: { role: true } },
    },
  });

  if (!shift) throw AppError.notFound('Shift not found');

  // Editing your OWN hours is refused outright, whatever your rank. It is the
  // same act as self-promotion in `staff.service.ts`: the person who benefits
  // must not be the person who approves.
  if (shift.userId === actor.id) {
    throw AppError.forbidden('You cannot edit your own shift');
  }

  if (outranks(shift.user.role, actor.role)) {
    throw AppError.forbidden('You cannot modify someone with more access than you');
  }

  const startedAt = input.startedAt ? new Date(input.startedAt) : shift.startedAt;
  const endedAt =
    input.endedAt === undefined
      ? shift.endedAt
      : input.endedAt === null
        ? null
        : new Date(input.endedAt);

  if (Number.isNaN(startedAt.getTime())) {
    throw AppError.badRequest('Invalid start time', { field: 'startedAt' });
  }

  if (endedAt !== null && Number.isNaN(endedAt.getTime())) {
    throw AppError.badRequest('Invalid end time', { field: 'endedAt' });
  }

  // A shift that ends before it starts is not a correction, it is a typo —
  // and it would render as a negative duration everywhere it is summed.
  if (endedAt !== null && endedAt <= startedAt) {
    throw AppError.badRequest('A shift cannot end before it starts', { field: 'endedAt' });
  }

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      startedAt,
      endedAt,
      // `??` not `=`: only the FIRST edit records the original. A second edit
      // must not overwrite it with the first edit's values.
      originalStartedAt: shift.originalStartedAt ?? shift.startedAt,
      originalEndedAt: shift.originalEndedAt ?? shift.endedAt,
      editedById: actor.id,
      editReason: input.reason,
      editedAt: new Date(),
    },
    select: SHIFT_SELECT,
  });

  return serialise(updated);
}

/**
 * Approve a shift (O9.19).
 *
 * ─── A RECORD, NOT A GATE ─────────────────────────────────────────────
 * The owner's own call: a shift starts and the till works immediately —
 * `startShift`'s note stands unchanged, clocking on is not a privileged act.
 * This is a manager confirming afterward (or while it's still running) that
 * the shift is legitimate, the same "warn/record, don't block" shape the
 * till already uses for over-stock and discount-cap nudges. A manager being
 * slow or offline never stops someone from selling.
 *
 * Only a PENDING shift can be approved — approving an already-APPROVED one
 * is a no-op that would silently overwrite who approved it and when, and
 * approving a REJECTED one would erase the rejection without a trace.
 * Re-deciding needs a deliberate `reset` first (not built — no request for
 * it yet), not a second approve/reject call landing on top of the first.
 */
export async function approveShift(actor: ShiftActor, shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, userId: true, approvalStatus: true, user: { select: { role: true } } },
  });

  if (!shift) throw AppError.notFound('Shift not found');

  // Same two rules as editing: the person who benefits must not be the
  // person who approves, and rank is never crossed upward.
  if (shift.userId === actor.id) {
    throw AppError.forbidden('You cannot approve your own shift');
  }

  if (outranks(shift.user.role, actor.role)) {
    throw AppError.forbidden('You cannot approve someone with more access than you');
  }

  if (shift.approvalStatus !== ShiftApprovalStatus.PENDING) {
    throw AppError.badRequest(
      `This shift is already ${shift.approvalStatus.toLowerCase()}`,
      { field: 'approvalStatus' },
    );
  }

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      approvalStatus: ShiftApprovalStatus.APPROVED,
      approvedById: actor.id,
      approvedAt: new Date(),
      approvalNote: null,
    },
    select: SHIFT_SELECT,
  });

  return serialise(updated);
}

/**
 * Reject a shift (O9.19) — same shape as approving, opposite outcome. A
 * reason is required, the same discipline `Return.rejectionReason` uses: a
 * rejected shift with no stated reason is the complaint that follows.
 *
 * Deliberately does NOT touch `endedAt`/stock/payments — rejecting is a
 * statement about the RECORD, not an undo of a sale that already happened
 * during it. A rejected shift's sales are unaffected; if one needs undoing,
 * that is `voidSale`'s job, done separately per order.
 */
export async function rejectShift(actor: ShiftActor, shiftId: string, note: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, userId: true, approvalStatus: true, user: { select: { role: true } } },
  });

  if (!shift) throw AppError.notFound('Shift not found');

  if (shift.userId === actor.id) {
    throw AppError.forbidden('You cannot reject your own shift');
  }

  if (outranks(shift.user.role, actor.role)) {
    throw AppError.forbidden('You cannot reject someone with more access than you');
  }

  if (shift.approvalStatus !== ShiftApprovalStatus.PENDING) {
    throw AppError.badRequest(
      `This shift is already ${shift.approvalStatus.toLowerCase()}`,
      { field: 'approvalStatus' },
    );
  }

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      approvalStatus: ShiftApprovalStatus.REJECTED,
      approvedById: actor.id,
      approvedAt: new Date(),
      approvalNote: note,
    },
    select: SHIFT_SELECT,
  });

  return serialise(updated);
}

export interface ShiftListParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  branchId?: string;
  /** Only shifts that are still open — "who is on right now". */
  openOnly?: boolean;
  /** A manager's pending-approval queue (O9.19) when set to PENDING. */
  approvalStatus?: ShiftApprovalStatus;
  from?: string;
  to?: string;
}

const MAX_PAGE_SIZE = 100;

export async function listShifts(params: ShiftListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.ShiftWhereInput = {
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.openOnly ? OPEN : {}),
    ...(params.approvalStatus ? { approvalStatus: params.approvalStatus } : {}),
    ...(params.from || params.to
      ? {
          startedAt: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.shift.findMany({
      where,
      // Open shifts first, then newest — "who is on now" is the question this
      // page is usually opened to answer.
      orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: SHIFT_SELECT,
    }),
    prisma.shift.count({ where }),
  ]);

  return {
    shifts: rows.map(serialise),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * What somebody did during one shift (F6.4).
 *
 * ─── NO NEW LOGGING ──────────────────────────────────────────────────
 * Every write in this app already reaches `AuditLog` with an actor and a
 * timestamp. A shift is a person plus a time span, so "what happened on that
 * shift" is a query over data that already exists — adding a second, parallel
 * activity log would be two records of one fact, free to disagree.
 *
 * ─── WHY NOT `auditWhere` ────────────────────────────────────────────
 * That helper's `from`/`to` are CALENDAR DATES (`YYYY-MM-DD`, snapped to the
 * day's start and end). A shift is a timestamp range inside a day — "since
 * 09:02" — and rounding it to midnight would attribute the night shift's work
 * to the morning one. The range here is exact.
 *
 * An OPEN shift is summarised up to now, which is the honest reading: the
 * person is still working, and the count is what they have done so far.
 */
export async function getShiftSummary(shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: SHIFT_SELECT,
  });

  if (!shift) throw AppError.notFound('Shift not found');

  const until = shift.endedAt ?? new Date();

  const where = {
    actorId: shift.user.id,
    createdAt: { gte: shift.startedAt, lte: until },
  } as const;

  // `groupBy` is issued outside the transaction array on purpose: inside it,
  // Prisma widens `_count` to `true` and the typed shape is lost. These are
  // three reads over an append-only table, so they cannot disagree anyway.
  const [total, recent] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, action: true, entity: true, entityId: true, createdAt: true },
    }),
  ]);

  const byAction = await prisma.auditLog.groupBy({
    by: ['action'],
    where,
    _count: { action: true },
    orderBy: { _count: { action: 'desc' } },
    take: 10,
  });

  return {
    shift: serialise(shift),
    /** Total audited writes in the window. Reads are not audited, so this is
     *  "what they CHANGED", never "how busy they were" — a distinction the
     *  UI has to state rather than let a big number imply. */
    totalActions: total,
    byAction: byAction.map((row) => ({ action: row.action, count: row._count.action })),
    recent: recent.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * TILL SESSION (O5.3)
 *
 * A shift and a till session are the same object — the owner's answer,
 * 2026-09-08 — so opening a drawer is opening a shift WITH a float, and
 * counting down is closing it with a count.
 * ───────────────────────────────────────────────────────────────────── */

/** Money taken during a shift, by method. Cash is what a drawer holds. */
export async function getShiftTakings(shiftId: string) {
  const rows = await prisma.payment.groupBy({
    by: ['method'],
    where: { shiftId },
    _sum: { amount: true },
  });

  const byMethod = rows.map((row) => ({
    method: row.method,
    // A group with no rows cannot occur here, but `_sum` is nullable in the
    // type, and a silent 0 would be indistinguishable from a real zero total.
    total: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
  }));

  // Raw cash SALES — unchanged meaning, still what the mid-shift "what have
  // we taken" read shows.
  const cash = rows
    .filter((row) => row.method.toLowerCase() === 'cash')
    .reduce((sum, row) => sum.add(row._sum.amount ?? 0), new Prisma.Decimal(0));

  // Cash drops and payouts (O9 Tier 4) both remove money FROM the physical
  // drawer, so both reduce what should still be sitting in it at close —
  // same direction, summed together rather than tracked separately, since
  // the variance formula only cares "how much left the drawer outside a
  // sale", not which of the two reasons it left for.
  const removed = await prisma.tillEvent.aggregate({
    where: { shiftId, type: { in: [TillEventType.CASH_DROP, TillEventType.PAYOUT] } },
    _sum: { amount: true },
  });

  const removedTotal = removed._sum.amount ?? new Prisma.Decimal(0);

  /**
   * Cash held in a currency other than the store's own, counted SEPARATELY.
   *
   * Owner decision: change is given in whatever was tendered, so a drawer can
   * end the day holding two currencies — and each is counted in its own units
   * at close. Converting them into one expected total would make a genuine
   * shortfall indistinguishable from the rate moving during the shift, which
   * is the one thing a variance figure must never be ambiguous about.
   *
   * `tenderAmount`, not `amount`: the cashier counts the notes actually in the
   * drawer, which are foreign currency. `amount` is the base-currency value of
   * the same payment and is what the existing `cash`/`expectedCash`
   * reconciliation above already covers — so this is additive and changes none
   * of it.
   */
  const foreignRows = await prisma.payment.groupBy({
    by: ['tenderCurrency'],
    where: { shiftId, tenderCurrency: { not: null }, method: 'cash' },
    _sum: { tenderAmount: true, change: true },
  });

  const byTenderCurrency = foreignRows
    .filter((row) => row.tenderCurrency !== null)
    .map((row) => ({
      currency: row.tenderCurrency as string,
      // Taken minus change given back, both in that currency — what should
      // physically remain in the drawer for it.
      expected: (row._sum.tenderAmount ?? new Prisma.Decimal(0))
        .sub(row._sum.change ?? new Prisma.Decimal(0))
        .toFixed(2),
    }));

  return {
    byMethod,
    byTenderCurrency,
    cash,
    // What should physically be in the drawer, given sales and what has
    // left it since — the figure `closeTill` actually reconciles against.
    // Distinct from `cash` on purpose: `cash` alone would make the shown
    // "expected" figure invite the count to be typed to match SALES rather
    // than the true expected drawer content, exactly the outcome the
    // shift-close dialog's own ordering (expected shown AFTER the count)
    // already exists to avoid.
    expectedCash: cash.sub(removedTotal),
  };
}

/**
 * Close a shift and reconcile the drawer.
 *
 * ─── VARIANCE IS STORED, NOT RECOMPUTED ──────────────────────────────
 * `counted - (float + cash takings)`, worked out here and written to the row.
 * Recomputing it on read would let a refund issued next week silently rewrite
 * what the cashier signed off tonight — the same snapshot rule as
 * `Order.total` and `OrderItem.cost`.
 *
 * A negative variance is short, a positive one is over. Neither is refused:
 * the drawer is what it is, and a till that rejects an inconvenient count is
 * one people stop counting honestly.
 */
export async function closeTill(
  actor: ShiftActor,
  shiftId: string,
  closingCount: string,
  note?: string,
) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      userId: true,
      endedAt: true,
      openingFloat: true,
      user: { select: { role: true } },
    },
  });

  if (!shift) throw AppError.notFound('Shift not found');

  if (shift.endedAt !== null) {
    throw AppError.badRequest('That shift has already ended');
  }

  if (shift.userId !== actor.id && outranks(shift.user.role, actor.role)) {
    throw AppError.forbidden('You cannot modify someone with more access than you');
  }

  const counted = new Prisma.Decimal(closingCount);
  // `expectedCash`, not `cash` — sales alone would ignore every drop and
  // payout since the shift opened (O9 Tier 4), reporting a false shortage
  // for cash that was deliberately, correctly removed from the drawer.
  const { expectedCash } = await getShiftTakings(shiftId);
  const expected = (shift.openingFloat ?? new Prisma.Decimal(0)).add(expectedCash);

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      endedAt: new Date(),
      closingCount: counted,
      variance: counted.sub(expected),
      ...(note ? { note } : {}),
    },
    select: SHIFT_SELECT,
  });

  return {
    shift: serialise(updated),
    expected: expected.toFixed(2),
    counted: counted.toFixed(2),
    variance: counted.sub(expected).toFixed(2),
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * TILL EVENTS — no-sale, cash drop, payout (O9 Tier 4)
 * ───────────────────────────────────────────────────────────────────── */

export interface RecordTillEventInput {
  type: TillEventType;
  /** Required for CASH_DROP/PAYOUT, refused for NO_SALE — see `recordTillEvent`. */
  amount?: string | undefined;
  note?: string | undefined;
}

/**
 * Log a drawer event with no sale behind it. Must belong to an OPEN shift —
 * an event on a closed one has no drawer left to adjust, and `closeTill`'s
 * variance math for that shift was already computed and stored.
 */
export async function recordTillEvent(
  shiftId: string,
  input: RecordTillEventInput,
  actorId: string,
) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, endedAt: true },
  });

  if (!shift) throw AppError.notFound('Shift not found');
  if (shift.endedAt !== null) {
    throw AppError.badRequest('This shift has already ended');
  }

  if (input.type === TillEventType.NO_SALE) {
    if (input.amount !== undefined) {
      throw AppError.badRequest('A no-sale open does not take an amount', { field: 'amount' });
    }
  } else if (input.amount === undefined) {
    // CASH_DROP / PAYOUT
    throw AppError.badRequest('An amount is required', { field: 'amount' });
  } else if (new Prisma.Decimal(input.amount).lessThanOrEqualTo(0)) {
    throw AppError.badRequest('Enter an amount above zero', { field: 'amount' });
  }

  const event = await prisma.tillEvent.create({
    data: {
      shiftId,
      type: input.type,
      amount: input.amount === undefined ? null : new Prisma.Decimal(input.amount),
      note: input.note ?? null,
      actorId,
    },
    select: { id: true, type: true, amount: true, note: true, createdAt: true },
  });

  return {
    id: event.id,
    type: event.type,
    amount: event.amount?.toFixed(2) ?? null,
    note: event.note,
    createdAt: event.createdAt.toISOString(),
  };
}

/** The events logged this shift, newest first — the X/Z report's own read
 *  of the same table `getShiftTakings` aggregates. */
export async function listTillEvents(shiftId: string) {
  const events = await prisma.tillEvent.findMany({
    where: { shiftId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, amount: true, note: true, createdAt: true, actorId: true },
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    amount: event.amount?.toFixed(2) ?? null,
    note: event.note,
    createdAt: event.createdAt.toISOString(),
    actorId: event.actorId,
  }));
}

/**
 * The X/Z report (O9 Tier 4) — the printable end-of-day summary. "X" and
 * "Z" in standard POS terms are the same shape at different moments: an X
 * report is this, run mid-shift, non-destructive; a Z report is this, run
 * after `closeTill` has already finalised the shift. Nothing here decides
 * which is which — the CALLER does, by asking before or after close — so
 * there is one function, not two.
 */
export async function getTillReport(shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: SHIFT_SELECT,
  });

  if (!shift) throw AppError.notFound('Shift not found');

  const [takings, events] = await Promise.all([
    getShiftTakings(shiftId),
    listTillEvents(shiftId),
  ]);

  const noSaleCount = events.filter((event) => event.type === TillEventType.NO_SALE).length;
  const cashDrops = events.filter((event) => event.type === TillEventType.CASH_DROP);
  const payouts = events.filter((event) => event.type === TillEventType.PAYOUT);

  const sumAmounts = (rows: typeof events) =>
    rows
      .reduce((sum, row) => sum.add(row.amount ?? '0'), new Prisma.Decimal(0))
      .toFixed(2);

  return {
    shift: serialise(shift),
    byMethod: takings.byMethod,
    /**
     * URG-034 — forwarded, not recomputed. `getShiftTakings` already counts
     * foreign cash per currency (each in its OWN units, deliberately never
     * converted into one expected total), and this report was silently
     * dropping it: the breakdown existed in the service and never reached the
     * client, so a drawer holding two currencies printed a Z report that
     * accounted for only one of them.
     *
     * Already strings from `getShiftTakings` (`.toFixed(2)` per row), unlike
     * the Decimal fields below.
     */
    byTenderCurrency: takings.byTenderCurrency,
    // `getShiftTakings` returns these as `Prisma.Decimal` — fine when a
    // ROUTE hands them straight to `res.json()` (Decimal serialises to a
    // string via its own `toJSON`), but this function is called BY a
    // service, not a route, so the conversion has to happen explicitly here
    // rather than relying on a JSON boundary that may not exist.
    cash: takings.cash.toFixed(2),
    expectedCash: takings.expectedCash.toFixed(2),
    noSaleCount,
    cashDropTotal: sumAmounts(cashDrops),
    payoutTotal: sumAmounts(payouts),
    events,
    /** Only meaningful once the shift is actually closed — null on an X
     *  report taken mid-shift, since `closeTill` has not run yet. */
    isFinal: shift.endedAt !== null,
  };
}
