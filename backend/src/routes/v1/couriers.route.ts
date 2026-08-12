import { DeliveryStaffStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  assignOrder,
  createCourier,
  getCourier,
  listCouriers,
  regenerateAccessCode,
  revokeAccessCode,
  unassignOrder,
  updateAssignment,
  updateCourier,
} from '../../services/couriers.service.js';

/**
 * Couriers and delivery assignments.
 *
 * Named routes rather than the generic engine. Couriers LOOK like a plain CRUD
 * resource, but they carry a credential: issuing and revoking an access code is
 * an action with a one-time secret in its response, and the engine has no
 * vocabulary for either. `delivery_staff` is deliberately absent from
 * admin.config.ts for the same reason `users` is.
 */

export const couriersRouter = Router();

const guard = [authenticate, requireArea('delivery')] as const;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.nativeEnum(DeliveryStaffStatus).optional(),
});

const courierBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    email: z.string().trim().email('Enter a valid email address').max(255).optional(),
    phone: z.string().trim().max(48).optional(),
    vehicleType: z.string().trim().max(48).optional(),
    plateNumber: z.string().trim().max(48).optional(),
    zone: z.string().trim().max(96).optional(),
    region: z.string().trim().max(96).optional(),
    country: z.string().trim().max(96).optional(),
    status: z.nativeEnum(DeliveryStaffStatus).optional(),
  })
  .strict();

const assignBody = z
  .object({
    orderId: z.string().trim().min(1),
    driverId: z.string().trim().min(1),
    address: z.string().trim().max(255).optional(),
    city: z.string().trim().max(96).optional(),
    note: z.string().trim().max(255).optional(),
  })
  .strict();

const updateAssignmentBody = z
  .object({
    address: z.string().trim().max(255).optional(),
    city: z.string().trim().max(96).optional(),
    note: z.string().trim().max(255).optional(),
  })
  .strict();

couriersRouter.get('/couriers', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  res.json({ data: await listCouriers(parsed.data) });
});

couriersRouter.get('/couriers/:id', ...guard, async (req, res) => {
  res.json({ data: { courier: await getCourier(String(req.params.id)) } });
});

couriersRouter.post('/couriers', ...guard, async (req, res) => {
  const parsed = courierBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  res.status(201).json({ data: { courier: await createCourier(parsed.data) } });
});

couriersRouter.patch('/couriers/:id', ...guard, async (req, res) => {
  const parsed = courierBody.partial().safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  if (Object.keys(parsed.data).length === 0) {
    throw AppError.badRequest('Provide at least one field to write');
  }

  res.json({ data: { courier: await updateCourier(String(req.params.id), parsed.data, req) } });
});

/**
 * Issue a new access code.
 *
 * POST, not GET: it CHANGES the courier's credential, and a GET would be
 * retried by proxies and prefetchers. The plaintext appears in this response
 * and nowhere else, ever.
 */
couriersRouter.post('/couriers/:id/access-code', ...guard, async (req, res) => {
  const user = requireUser(req);
  const id = String(req.params.id);

  const result = await regenerateAccessCode(id);

  // The code itself is NEVER logged — that would put the credential straight
  // back into plain text, in a place with a longer retention than the database.
  req.log.info({
    event: 'delivery.access_code.issued',
    courierId: id,
    userId: user.id,
  });

  res.status(201).json({ data: result });
});

couriersRouter.delete('/couriers/:id/access-code', ...guard, async (req, res) => {
  const user = requireUser(req);
  const id = String(req.params.id);

  await revokeAccessCode(id);

  req.log.info({ event: 'delivery.access_code.revoked', courierId: id, userId: user.id });

  res.status(204).send();
});

couriersRouter.post('/assignments', ...guard, async (req, res) => {
  const parsed = assignBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);
  const assignment = await assignOrder(parsed.data);

  req.log.info({
    event: 'delivery.order.assigned',
    orderId: parsed.data.orderId,
    driverId: parsed.data.driverId,
    userId: user.id,
  });

  res.status(201).json({ data: { assignment } });
});

/**
 * Corrects address/city/note WITHOUT reassigning — B4.1. Reassigning
 * (`POST /assignments`) resets `status` back to ASSIGNED, which is right for
 * a real reassignment but wrong for "same courier, fix the typo." This is
 * the only route that can touch those three fields without that side effect.
 */
couriersRouter.patch('/assignments/:id', ...guard, async (req, res) => {
  const parsed = updateAssignmentBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  if (Object.keys(parsed.data).length === 0) {
    throw AppError.badRequest('Provide at least one field to write');
  }

  const user = requireUser(req);
  const id = String(req.params.id);
  const assignment = await updateAssignment(id, parsed.data);

  req.log.info({ event: 'delivery.assignment.updated', assignmentId: id, userId: user.id });

  res.json({ data: { assignment } });
});

couriersRouter.delete('/assignments/:id', ...guard, async (req, res) => {
  const user = requireUser(req);
  const id = String(req.params.id);

  await unassignOrder(id);

  req.log.info({ event: 'delivery.order.unassigned', assignmentId: id, userId: user.id });

  res.status(204).send();
});
