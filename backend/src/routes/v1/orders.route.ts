import { OrderStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { toCsv } from '../../lib/csv.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { audit } from '../../services/audit.service.js';
import {
  addOrderNote,
  bulkChangeOrderStatus,
  changeOrderStatus,
  getOrder,
  getOrderNeighbors,
  getOrderTimeline,
  listOrders,
  listOrdersForExport,
  previewBulkStatusChange,
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

// Only columns selected directly on the Order row — never `_count.items` or
// a relation field, neither of which Prisma can sort a flat `orderBy` by.
const SORTABLE_FIELDS = ['orderNumber', 'placedAt', 'total', 'status'] as const;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  // Date-only, so a caller cannot smuggle a timezone in and shift the range.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  search: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(SORTABLE_FIELDS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  // Same endpoint, same filters — only the serialisation differs, same
  // convention audit.route.ts already established for its own CSV export.
  format: z.enum(['json', 'csv']).optional(),
});

const statusBody = z
  .object({
    to: z.nativeEnum(OrderStatus, { message: 'Unknown order status' }),
    // Matches the column width, so a long note is a 400 rather than a
    // truncation the user never sees.
    note: z.string().trim().max(255).optional(),
  })
  .strict();

const noteBody = z
  .object({
    body: z.string().trim().min(1, 'A note cannot be empty').max(2000),
  })
  .strict();

const bulkStatusBody = z
  .object({
    // Capped well below the frontend's own select-all-matching ceiling
    // (2000) — a bulk status move loops one transaction per id, so this
    // caps how long a single request can run, not how many orders exist.
    ids: z.array(z.string().min(1)).min(1).max(200),
    to: z.nativeEnum(OrderStatus, { message: 'Unknown order status' }),
    note: z.string().trim().max(255).optional(),
  })
  .strict();

/** Same shape minus `note` — a preview has nothing to write. */
const bulkStatusPreviewBody = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(200),
    to: z.nativeEnum(OrderStatus, { message: 'Unknown order status' }),
  })
  .strict();

ordersRouter.get('/orders', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  if (parsed.data.format === 'csv') {
    const { orders, truncated } = await listOrdersForExport(parsed.data);

    // Exporting the list is itself an auditable event — same reasoning as
    // audit.route.ts's own `audit.exported`: a copy of order data (customer
    // names, emails) leaving the system is exactly what a reviewer would
    // want a record of.
    audit(req, {
      action: 'orders.exported',
      entity: 'order',
      changes: {
        rowCount: orders.length,
        truncated,
        filters: {
          status: parsed.data.status ?? null,
          from: parsed.data.from ?? null,
          to: parsed.data.to ?? null,
          search: parsed.data.search ?? null,
        },
      },
    });

    // Header, not an extra CSV row — a short export that claims to be
    // complete is the failure mode worth avoiding here.
    res.set('X-Export-Truncated', String(truncated));

    res
      .status(200)
      .type('text/csv')
      .set('Content-Disposition', 'attachment; filename="orders.csv"')
      .send(
        toCsv(orders, [
          { header: 'Order number', value: (o) => o.orderNumber },
          { header: 'Status', value: (o) => o.status },
          { header: 'Placed (UTC)', value: (o) => o.placedAt },
          { header: 'Items', value: (o) => o.itemCount },
          { header: 'Total', value: (o) => o.total ?? '' },
          { header: 'Payment method', value: (o) => o.paymentMethod ?? '' },
          { header: 'Customer name', value: (o) => o.customerName ?? '' },
          { header: 'Customer email', value: (o) => o.customerEmail ?? '' },
        ]),
      );
    return;
  }

  res.json({ data: await listOrders(parsed.data) });
});

ordersRouter.get('/orders/:id', ...guard, async (req, res) => {
  res.json({ data: { order: await getOrder(String(req.params.id)) } });
});

/**
 * Prev/next within the SAME filtered, sorted list a staff member was looking
 * at before they opened this order — same query params the list view sends,
 * reusing `buildWhere`/`buildOrderBy` so the two can never disagree.
 */
const neighborsQuery = listQuery.omit({ page: true, pageSize: true, format: true });

ordersRouter.get('/orders/:id/neighbors', ...guard, async (req, res) => {
  const parsed = neighborsQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  res.json({ data: await getOrderNeighbors(String(req.params.id), parsed.data) });
});

/**
 * The full timeline (C5.4) — status moves, staff edits, delivery-status
 * pings and return decisions, chronologically merged. See
 * `getOrderTimeline`'s own doc comment for why this needs three separate
 * reads rather than one query.
 */
ordersRouter.get('/orders/:id/timeline', ...guard, async (req, res) => {
  res.json({ data: { events: await getOrderTimeline(String(req.params.id)) } });
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

/**
 * What a bulk status change WOULD do (C5.5) — read before the real POST
 * below, so the confirmation dialog can name a real dependency count and
 * flag a terminal target instead of a generic "are you sure?".
 */
ordersRouter.post('/orders/bulk-status/preview', ...guard, async (req, res) => {
  const parsed = bulkStatusPreviewBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  res.json({ data: await previewBulkStatusChange(parsed.data.ids, parsed.data.to) });
});

/**
 * POST, not PATCH: this moves a SET of resources, not one at the URL's own
 * id, and reports a mixed per-id outcome (200 even when some ids were
 * skipped) rather than the single pass/fail a PATCH implies.
 */
ordersRouter.post('/orders/bulk-status', ...guard, async (req, res) => {
  const parsed = bulkStatusBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);

  const result = await bulkChangeOrderStatus(parsed.data.ids, {
    to: parsed.data.to,
    note: parsed.data.note,
    actorId: user.id,
  });

  req.log.info({
    event: 'order.status.bulkChanged',
    to: parsed.data.to,
    succeeded: result.succeeded.length,
    skipped: result.skipped.length,
    userId: user.id,
  });

  res.json({ data: result });
});

/**
 * POST, not PATCH (C5.7): this ADDS to the thread, it does not overwrite
 * whatever the last person wrote — the single-field shape this replaced let
 * a second staff member's save silently erase the first one's.
 */
ordersRouter.post('/orders/:id/notes', ...guard, async (req, res) => {
  const parsed = noteBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);
  const order = await addOrderNote(String(req.params.id), parsed.data.body, user.id);

  res.json({ data: { order } });
});
