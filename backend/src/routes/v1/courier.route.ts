import { DeliveryStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticateCourier, requireCourier } from '../../middleware/authenticateCourier.js';
import { courierAuthRateLimit } from '../../middleware/rateLimit.js';
import { signCourierToken } from '../../services/courier-auth.service.js';
import {
  courierForCode,
  listOwnAssignments,
  updateAssignmentStatus,
} from '../../services/couriers.service.js';

/**
 * The courier-facing surface — a SEPARATE auth surface from every other route
 * in this API (see `courier-auth.service.ts`). A courier is not a `User` and
 * never reaches `/staff`, `/couriers`, or anything gated by `authenticate` /
 * `requireArea`. Everything here is scoped to the calling courier's OWN
 * record; there is no route here that can see or touch another courier's
 * assignments.
 *
 * `/couriers/*` (plural, staff-facing, in `couriers.route.ts`) is where an
 * admin manages the roster and issues access codes. This file is what the
 * person holding one of those codes calls.
 */

export const courierRouter = Router();

const authBody = z
  .object({
    // Formatted with dashes when issued (see `generateCode`), but accepted
    // either way — `courierForCode` normalises before hashing, so requiring
    // the exact punctuation here would just be a way to reject a valid code.
    code: z.string().trim().min(1, 'Access code is required').max(20),
  })
  .strict();

// POST /api/v1/courier/auth
courierRouter.post('/courier/auth', courierAuthRateLimit, async (req, res) => {
  const parsed = authBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  // NEVER log the code itself — same rule as a staff password.
  req.log.info({ event: 'courier.auth.attempted' });

  const courier = await courierForCode(parsed.data.code);

  if (!courier) {
    // Same message whether the code is unknown, wrong, or belongs to a
    // deactivated courier — telling those apart is an enumeration oracle.
    req.log.warn({ event: 'courier.auth.failed' });
    throw AppError.unauthorized('Invalid access code');
  }

  req.log.info({ event: 'courier.auth.succeeded', courierId: courier.id });

  res.status(200).json({ data: { token: signCourierToken(courier.id), courier } });
});

const guard = [authenticateCourier] as const;

// GET /api/v1/courier/me/assignments
courierRouter.get('/courier/me/assignments', ...guard, async (req, res) => {
  const courier = requireCourier(req);

  res.json({ data: { assignments: await listOwnAssignments(courier.id) } });
});

const statusBody = z
  .object({
    status: z.nativeEnum(DeliveryStatus),
  })
  .strict();

// PATCH /api/v1/courier/assignments/:id/status
courierRouter.patch('/courier/assignments/:id/status', ...guard, async (req, res) => {
  const parsed = statusBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const courier = requireCourier(req);
  const id = String(req.params.id);

  const assignment = await updateAssignmentStatus(id, courier.id, parsed.data.status);

  req.log.info({
    event: 'courier.assignment.status_updated',
    assignmentId: id,
    status: parsed.data.status,
    courierId: courier.id,
  });

  res.json({ data: { assignment } });
});
