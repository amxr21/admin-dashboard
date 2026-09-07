import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import { audit } from '../../services/audit.service.js';
import {
  editShift,
  endShift,
  getOpenShift,
  getShiftSummary,
  listShifts,
  startShift,
} from '../../services/shifts.service.js';
import { canAccessArea } from '../../config/roles.js';

/**
 * Shifts — a period of work (F6).
 *
 * ─── WHY CLOCKING ON IS NOT BEHIND AN AREA ───────────────────────────
 * `/shifts/me` and starting/ending your OWN shift need `authenticate` only.
 * Every role that works a shift — cashier, fulfilment, support — must be able
 * to clock on, and gating that behind an area would mean the people who
 * actually work shifts are the ones who cannot record them.
 *
 * Reading OTHER people's shifts is different: it is personnel data, so the
 * list sits behind `staff`, the same area that guards the audit trail and
 * login history for exactly the same reason.
 */

export const shiftsRouter = Router();

/** GET /api/v1/shifts/me — my open shift, or null. Drives the shell control. */
shiftsRouter.get('/shifts/me', authenticate, async (req, res) => {
  const user = requireUser(req);

  res.status(200).json({ data: { shift: await getOpenShift(user.id) } });
});

const startSchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  /** Opening a shift for somebody who forgot to clock in. Rank-checked. */
  forUserId: z.string().trim().min(1).optional(),
  note: z.string().trim().max(255).optional(),
});

shiftsRouter.post('/shifts', authenticate, withBranchContext, async (req, res) => {
  const parsed = startSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);

  const shift = await startShift(
    { id: user.id, role: user.role },
    {
      // Falls back to the active branch from the switcher before the service's
      // own default — the shift belongs where the person is actually working.
      branchId: parsed.data.branchId ?? req.branchId ?? undefined,
      forUserId: parsed.data.forUserId,
      note: parsed.data.note,
    },
  );

  audit(req, {
    action: 'shift.started',
    entity: 'shifts',
    entityId: shift.id,
    changes: {
      user: { from: null, to: shift.user.email },
      branch: { from: null, to: shift.branch.name },
      startedAt: { from: null, to: shift.startedAt },
    },
  });

  res.status(201).json({ data: { shift } });
});

const endSchema = z.object({ note: z.string().trim().max(255).optional() });

shiftsRouter.post('/shifts/:id/end', authenticate, async (req, res) => {
  const parsed = endSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);
  const shift = await endShift({ id: user.id, role: user.role }, String(req.params.id), parsed.data.note);

  audit(req, {
    action: 'shift.ended',
    entity: 'shifts',
    entityId: shift.id,
    changes: {
      user: { from: shift.user.email, to: shift.user.email },
      endedAt: { from: null, to: shift.endedAt },
    },
  });

  res.status(200).json({ data: { shift } });
});

const editSchema = z.object({
  startedAt: z.string().trim().min(1).optional(),
  endedAt: z.string().trim().min(1).nullable().optional(),
  /**
   * Required, not optional. An edited timesheet without a stated reason is
   * the thing the "corrections stay visible" rule exists to prevent — the
   * record would show that hours changed and nothing about why.
   */
  reason: z.string().trim().min(1).max(255),
});

/**
 * PATCH /api/v1/shifts/:id — correct the recorded times.
 *
 * Behind `staff`: correcting somebody's hours is a personnel act, not part of
 * working a shift. The service refuses editing your OWN shift regardless of
 * rank — the person who benefits must not be the person who approves.
 */
shiftsRouter.patch('/shifts/:id', authenticate, requireArea('staff'), async (req, res) => {
  const parsed = editSchema.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);
  const shift = await editShift({ id: user.id, role: user.role }, String(req.params.id), parsed.data);

  audit(req, {
    action: 'shift.edited',
    entity: 'shifts',
    entityId: shift.id,
    changes: {
      // Both sides recorded: "changed the end time" is unanswerable without
      // what it was before.
      startedAt: { from: shift.originalStartedAt, to: shift.startedAt },
      endedAt: { from: shift.originalEndedAt, to: shift.endedAt },
      reason: { from: null, to: shift.editReason },
    },
  });

  res.status(200).json({ data: { shift } });
});

/**
 * GET /api/v1/shifts — who worked when.
 *
 * Behind `staff`, like the audit trail and login history: it names who was
 * present and for how long, which is personnel data rather than a business
 * metric.
 */
const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  userId: z.string().trim().min(1).optional(),
  open: z.enum(['true', 'false']).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
});

shiftsRouter.get('/shifts', authenticate, withBranchContext, requireArea('staff'), async (req, res) => {
  // Parsed rather than cast: an Express query value can arrive as an array or
  // a nested object (`?userId[x]=1`), and `String()` on one of those yields
  // "[object Object]" — a filter that silently matches nothing.
  const parsed = listQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  const result = await listShifts({
    ...parsed.data,
    // Scoped to the active branch by default, like every other list (F8.3).
    branchId: req.branchId ?? undefined,
    openOnly: parsed.data.open === 'true',
  });

  res.status(200).json({ data: result });
});

/**
 * GET /api/v1/shifts/:id/summary — what happened during one shift (F6.4).
 *
 * ─── YOUR OWN IS ALWAYS READABLE ─────────────────────────────────────
 * Not behind `staff` for the shift's own owner: "what did I do today" is a
 * question about your own work, and a cashier reviewing their own shift is
 * not reading personnel data about anybody else. Somebody ELSE's needs
 * `staff`, like the rest of this file.
 *
 * Checked here rather than in the service because it is an authorisation
 * question about the CALLER, and the service is also reachable from places
 * where there is no request to authorise.
 */
shiftsRouter.get('/shifts/:id/summary', authenticate, async (req, res) => {
  const user = requireUser(req);
  const summary = await getShiftSummary(String(req.params.id));

  if (summary.shift.user.id !== user.id && !canAccessArea(user.role, 'staff')) {
    throw AppError.forbidden("You cannot view someone else's shift");
  }

  res.status(200).json({ data: summary });
});
