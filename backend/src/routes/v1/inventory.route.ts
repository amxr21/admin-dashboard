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

import { applyReceive, previewReceive } from '../../services/bulk-receive.service.js';
import {
  createSupplier,
  listProductSuppliers,
  listSuppliers,
  sendSupplierOutreach,
  updateSupplier,
} from '../../services/suppliers.service.js';
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

const supplierBody = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(255).nullish(),
  phone: z.string().trim().max(40).nullish(),
  contactName: z.string().trim().max(160).nullish(),
  note: z.string().trim().max(255).nullish(),
  isActive: z.boolean().optional(),
}).strict();

const supplierListQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  active: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

inventoryRouter.get('/suppliers', ...guard, async (req, res) => {
  const parsed = supplierListQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());
  res.json({ data: await listSuppliers(parsed.data) });
});

inventoryRouter.post('/suppliers', ...guard, async (req, res) => {
  const parsed = supplierBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());
  res.status(201).json({ data: await createSupplier(parsed.data, req) });
});

inventoryRouter.patch('/suppliers/:id', ...guard, async (req, res) => {
  const parsed = supplierBody.partial().safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());
  res.json({ data: await updateSupplier(String(req.params.id), parsed.data, req) });
});

inventoryRouter.get('/inventory/:productId/suppliers', ...guard, async (req, res) => {
  res.json({ data: await listProductSuppliers(String(req.params.productId), req.branchId ?? undefined) });
});

const outreachBody = z.object({
  supplierId: z.string().trim().min(1),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000),
}).strict();

inventoryRouter.post('/inventory/:productId/supplier-outreach', ...guard, async (req, res) => {
  const parsed = outreachBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());
  res.json({
    data: await sendSupplierOutreach({
      productId: String(req.params.productId),
      branchId: req.branchId ?? undefined,
      ...parsed.data,
    }, req),
  });
});

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
    /**
     * Batch detail (F7.8) — facts about THIS delivery, entered once for the
     * whole receipt rather than per unit.
     *
     * Dates arrive as ISO strings and are validated here rather than trusted:
     * `new Date('nonsense')` yields an Invalid Date that Prisma rejects with a
     * message naming neither the field nor the value.
     */
    deliveredAt: z.string().trim().datetime({ offset: true }).optional(),
    purchasedAt: z.string().trim().datetime({ offset: true }).optional(),
    reference: z.string().trim().max(64).optional(),
    supplierId: z.string().trim().min(1).optional(),
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
  )
  /**
   * Batch detail follows the same rule as the cost, for the same reason.
   *
   * Nothing was delivered, purchased or invoiced when stock is written off as
   * damaged. Storing a delivery date on a DAMAGED movement would be a fact
   * nothing can interpret later; silently dropping it would lose data the user
   * believed they had entered. Refuse, naming the first offending field so the
   * form can point at it.
   */
  .refine(
    (body) =>
      INCOMING_REASONS.has(body.reason) ||
      (body.deliveredAt === undefined &&
        body.purchasedAt === undefined &&
        body.reference === undefined &&
        body.supplierId === undefined),
    {
      message: 'Delivery details only apply when stock is received',
      path: ['deliveredAt'],
    },
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
    deliveredAt: parsed.data.deliveredAt,
    purchasedAt: parsed.data.purchasedAt,
    reference: parsed.data.reference,
    supplierId: parsed.data.supplierId,
    actorId: user.id,
    // Pre-existing gap, found while applying O9.18: this route never read
    // the branch switcher's header at all, unlike `/receive` and the list
    // endpoint right above it — every single-movement adjustment silently
    // ignored the switcher and fell through to `defaultBranchId()`. A
    // single-business install never noticed; O9.18 now REFUSES a
    // branch-less write once more than one business exists, which is what
    // surfaced this.
    branchId: req.branchId ?? undefined,
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

/* ─────────────────────────────────────────────────────────────────────
 * BULK RECEIVE (F3.5)
 *
 * A delivery arrives with a note listing many products. Entering them one at
 * a time is the friction this removes.
 *
 * Two endpoints, preview then apply, mirroring the resource import: the
 * operator sees which lines resolved to which PRODUCT NAMES before anything
 * is written, because a SKU typo that happens to match a different real
 * product is otherwise invisible until the stock is wrong.
 * ───────────────────────────────────────────────────────────────────── */

const receiveLineSchema = z.object({
  sku: z.string().trim().max(120).optional(),
  barcode: z.string().trim().max(120).optional(),
  // Coerced because a CSV always arrives as strings; the service still
  // rejects a non-integer or a zero with a per-line message.
  quantity: z.coerce.number(),
  unitCost: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 12.50')
    .optional(),
  note: z.string().trim().max(255).optional(),
});

const receiveSchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  deliveredAt: z.string().trim().datetime({ offset: true }).optional(),
  purchasedAt: z.string().trim().datetime({ offset: true }).optional(),
  reference: z.string().trim().max(64).optional(),
  lines: z.array(receiveLineSchema).min(1),
});

/** Validates and writes nothing. Safe to call as often as the form likes. */
inventoryRouter.post('/inventory/receive/preview', ...guard, async (req, res) => {
  const parsed = receiveSchema.safeParse(req.body);

  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  res.status(200).json({ data: await previewReceive(parsed.data) });
});

/**
 * Applies the whole delivery, or none of it.
 *
 * A 200 with `received: 0` and per-line errors is a REFUSAL, not a failure —
 * the client renders the errors beside the lines. Reserving 4xx for malformed
 * requests keeps "your file has mistakes" distinct from "your request was
 * wrong", which are different problems for the person holding the delivery.
 */
inventoryRouter.post('/inventory/receive', ...guard, async (req, res) => {
  const parsed = receiveSchema.safeParse(req.body);

  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);

  const result = await applyReceive(
    { ...parsed.data, branchId: parsed.data.branchId ?? req.branchId ?? undefined },
    user.id,
    req,
  );

  res.status(result.received > 0 ? 201 : 200).json({ data: result });
});
