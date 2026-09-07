import { Prisma, StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { outranks } from '../config/roles.js';
import { defaultBranchId } from './inventory.service.js';

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
  user: { select: { id: true, name: true, email: true } },
  branch: { select: { id: true, name: true } },
  openedBy: { select: { id: true, name: true, email: true } },
  editedBy: { select: { id: true, name: true, email: true } },
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
 * Start a shift.
 *
 * `forUserId` lets a manager open one for somebody who forgot to clock in —
 * `openedById` records who actually did it, so the two are never conflated.
 * Opening for yourself is the ordinary case and needs no permission beyond
 * being signed in: clocking on is not a privileged act.
 */
export async function startShift(
  actor: ShiftActor,
  input: { branchId?: string | undefined; forUserId?: string | undefined; note?: string | undefined },
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

  const branchId = input.branchId ?? (await defaultBranchId());

  if (!branchId) {
    throw AppError.badRequest('No branch to record this shift against', { field: 'branchId' });
  }

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, isActive: true },
  });

  if (!branch) throw AppError.badRequest('Branch not found', { field: 'branchId' });

  const shift = await prisma.shift.create({
    data: {
      userId,
      branchId,
      openedById: actor.id,
      startedAt: new Date(),
      ...(input.note ? { note: input.note } : {}),
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

export interface ShiftListParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  branchId?: string;
  /** Only shifts that are still open — "who is on right now". */
  openOnly?: boolean;
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
