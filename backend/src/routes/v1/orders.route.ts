import { OrderStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  changeOrderStatus,
  getOrder,
  listOrders,
} from '../../services/orders.service.js';

/**
 * Orders.
 *
 * Named routes, not the generic engine: an order is three tables and a
 * lifecycle, not a row you edit. `orders` is NOT declared in admin.config.ts,
 * so `/r/orders` correctly 404s.
 *
 * Authorisation is middleware, before any handler logic — `requireArea`
 * decides whether the role may touch orders at all, and `assertCanWrite`
 * (inside `authenticate`) blocks the read-only demo role from every write by
 * HTTP method, so a new write route is restricted the instant it exists.
 */

export const ordersRouter = Router();

const guard = [authenticate, requireArea('orders')] as const;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  // Date-only, so a caller cannot smuggle a timezone in and shift the range.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const statusBody = z
  .object({
    to: z.nativeEnum(OrderStatus, { message: 'Unknown order status' }),
    // Matches the column width, so a long note is a 400 rather than a
    // truncation the user never sees.
    note: z.string().trim().max(255).optional(),
  })
  .strict();

ordersRouter.get('/orders', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  res.json({ data: await listOrders(parsed.data) });
});

ordersRouter.get('/orders/:id', ...guard, async (req, res) => {
  res.json({ data: { order: await getOrder(String(req.params.id)) } });
});

ordersRouter.patch('/orders/:id/status', ...guard, async (req, res) => {
  const parsed = statusBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);

  const order = await changeOrderStatus(String(req.params.id), {
    to: parsed.data.to,
    note: parsed.data.note,
    actorId: user.id,
  });

  req.log.info({
    event: 'order.status.changed',
    orderId: order.id,
    to: order.status,
    userId: user.id,
  });

  res.json({ data: { order } });
});
