import { StaffRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  createStaff,
  issueStaffPasswordResetToken,
  listStaff,
  resetStaffPassword,
  unlockStaff,
  updateStaff,
} from '../../services/staff.service.js';

/**
 * Staff accounts.
 *
 * `users` is deliberately absent from admin.config.ts — the engine would build
 * its select from a field list (one bad entry exposes `passwordHash`) and its
 * writes are a generic field merge, which is the exact shape of a privilege
 * escalation bug.
 *
 * Only OWNER and DEVELOPER reach the `staff` area at all; MANAGER explicitly
 * does not, because hiring and access control stay with the owner.
 *
 * There is NO delete route. Deactivation preserves the audit trail — a deleted
 * account takes with it the answer to "who approved this refund in March".
 */

export const staffRouter = Router();

const guard = [authenticate, requireArea('staff')] as const;

/**
 * 12 characters, not 8.
 *
 * This password is set BY an admin FOR someone else, so it is typed once and
 * often never changed. It cannot rely on the owner picking well.
 */
const password = z.string().min(12, 'Use at least 12 characters').max(200);

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  role: z.nativeEnum(StaffRole).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const createBody = z
  .object({
    email: z.string().trim().email('Enter a valid email address').max(255),
    name: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(48).optional(),
    role: z.nativeEnum(StaffRole, { message: 'Choose a role' }),
    password,
    accessExpiresAt: z.string().datetime().optional(),
  })
  .strict();

const updateBody = z
  .object({
    name: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(48).optional(),
    role: z.nativeEnum(StaffRole).optional(),
    isActive: z.boolean().optional(),
    accessExpiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

staffRouter.get('/staff', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  res.json({ data: await listStaff(parsed.data) });
});

staffRouter.post('/staff', ...guard, async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const created = await createStaff(actor, parsed.data);

  // The password is NEVER logged, and neither is the body. Only who did what.
  req.log.info({
    event: 'staff.created',
    staffId: created.id,
    role: created.role,
    userId: actor.id,
  });

  res.status(201).json({ data: { staff: created } });
});

staffRouter.patch('/staff/:id', ...guard, async (req, res) => {
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  if (Object.keys(parsed.data).length === 0) {
    throw AppError.badRequest('Provide at least one field to write');
  }

  const actor = requireUser(req);
  const id = String(req.params.id);
  const updated = await updateStaff(actor, id, parsed.data);

  // A role change is the security-relevant event, so it is logged explicitly
  // rather than buried in a generic "updated".
  if (parsed.data.role !== undefined) {
    req.log.warn({
      event: 'staff.role.changed',
      staffId: id,
      to: updated.role,
      userId: actor.id,
    });
  }

  if (parsed.data.isActive === false) {
    req.log.warn({ event: 'staff.deactivated', staffId: id, userId: actor.id });
  }

  res.json({ data: { staff: updated } });
});

staffRouter.post('/staff/:id/unlock', ...guard, async (req, res) => {
  const actor = requireUser(req);
  const id = String(req.params.id);

  const staff = await unlockStaff(actor, id);

  req.log.info({ event: 'staff.unlocked', staffId: id, userId: actor.id });

  res.json({ data: { staff } });
});

staffRouter.post('/staff/:id/password', ...guard, async (req, res) => {
  const parsed = z.object({ password }).strict().safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const id = String(req.params.id);

  const staff = await resetStaffPassword(actor, id, parsed.data.password);

  req.log.warn({ event: 'staff.password.reset', staffId: id, userId: actor.id });

  res.json({ data: { staff } });
});

staffRouter.post('/staff/:id/reset-token', ...guard, async (req, res) => {
  const actor = requireUser(req);
  const id = String(req.params.id);

  const result = await issueStaffPasswordResetToken(actor, id);

  // The token itself is NEVER logged — same rule as a courier access code.
  req.log.warn({ event: 'staff.password.reset-token.issued', staffId: id, userId: actor.id });

  res.status(201).json({ data: result });
});
