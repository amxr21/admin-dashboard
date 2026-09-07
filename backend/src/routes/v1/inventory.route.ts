import { StockMovementReason } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import {
  adjustStock,
  listInventory,
  listMovements,
  reconcile,
} from '../../services/inventory.service.js';

/**
 * Inventory.
 *
 * Named routes rather than the generic engine: stock is a movement log with a
 * multi-table transactional write, which config cannot describe. `inventory`
 * is deliberately absent from admin.config.ts.
 *
 * Authorisation is middleware, before any handler logic. `assertCanWrite`
 * (inside `authenticate`) blocks the read-only demo role from adjustments by
 * HTTP method, so a new write route is restricted the moment it exists.
 */

export const inventoryRouter = Router();

const guard = [authenticate, withBranchContext, requireArea('inventory')] as const;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  // Coerced from the string a query string always carries.
  lowStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  threshold: z.coerce.number().int().min(0).max(100000).optional(),
});

/** Reasons where stock ARRIVES, and so has an acquisition cost worth
 *  recording. CORRECTION is excluded on purpose: it reconciles a count, it
 *  does not represent a purchase. */
const INCOMING_REASONS = new Set<StockMovementReason>([
  StockMovementReason.RECEIVED,
  StockMovementReason.RETURNED,
]);

const adjustBody = z
  .object({
    /**
     * Signed and non-zero. Bounded because a typo'd paste of a barcode as a
     * quantity should be a 400, not a stock level of 8,412,779,003.
     */
    delta: z.number().int().refine((value) => value !== 0, 'Enter a non-zero amount'),
    reason: z.nativeEnum(StockMovementReason, { message: 'Choose a reason' }),
    // Matches the column width, so a long note is a 400 rather than a silent
    // truncation the user never sees.
    note: z.string().trim().max(255).optional(),
    /**
     * What ONE unit in this batch cost to acquire (F1.4a).
     *
     * A string, not a number: money is `Decimal(10,2)` in the schema and JS
     * floats cannot represent 0.1 exactly, so accepting a number here would
     * let rounding drift in before the value ever reached the database.
     * Same reason every other money field in this app crosses the wire as a
     * string.
     *
     * Zero IS allowed — free stock (a supplier sample, a warranty
     * replacement) is a real acquisition at a real cost of nothing, which is
     * different from "not recorded". Omitting the field is how you say the
     * latter.
     */
    unitCost: z
      .string()
      .trim()
      .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 12.50')
      .optional(),
  })
  .strict()
  /**
   * A cost only means something where stock is ACQUIRED.
   *
   * A DAMAGED/LOST/SOLD movement has no acquisition cost — accepting one
   * would store a number nothing can interpret later, and silently ignoring
   * it would lose data the user believed they had entered. Refuse instead,
   * naming the field so the form can point at it.
   */
  .refine(
    (body) => body.unitCost === undefined || INCOMING_REASONS.has(body.reason),
    { message: 'A unit cost only applies when stock is received', path: ['unitCost'] },
  );

inventoryRouter.get('/inventory', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  res.json({
    data: await listInventory({ ...parsed.data, branchId: req.branchId ?? undefined }),
  });
});

inventoryRouter.get('/inventory/:productId/movements', ...guard, async (req, res) => {
  const parsed = listQuery.pick({ page: true, pageSize: true }).safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  res.json({
    data: await listMovements(String(req.params.productId), {
      ...parsed.data,
      branchId: req.branchId ?? undefined,
    }),
  });
});

inventoryRouter.post('/inventory/:productId/movements', ...guard, async (req, res) => {
  const parsed = adjustBody.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);
  const productId = String(req.params.productId);

  const result = await adjustStock(productId, {
    delta: parsed.data.delta,
    reason: parsed.data.reason,
    note: parsed.data.note,
    unitCost: parsed.data.unitCost,
    actorId: user.id,
  }, req);

  req.log.info({
    event: 'inventory.stock.adjusted',
    productId,
    delta: parsed.data.delta,
    reason: parsed.data.reason,
    stock: result.product.stock,
    userId: user.id,
  });

  res.status(201).json({ data: result });
});

/**
 * Does the log still explain the number?
 *
 * Exposed so a discrepancy is diagnosable from the UI rather than requiring
 * database access. Read-only and cheap.
 */
inventoryRouter.get('/inventory/:productId/reconcile', ...guard, async (req, res) => {
  res.json({ data: await reconcile(String(req.params.productId)) });
});
