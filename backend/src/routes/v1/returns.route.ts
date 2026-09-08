import { ReturnCategory, ReturnResolution, ReturnStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import {
  approveReturn,
  createReturn,
  getReturn,
  listReturns,
  rejectReturn,
} from '../../services/returns.service.js';

/**
 * Returns / RMA.
 *
 * Named routes, not the generic engine — approving one is a procedure
 * (validate the order can move to RETURNED, optionally restock, record a
 * resolution), the same reason orders is bespoke rather than config.
 */

export const returnsRouter = Router();

const guard = [authenticate, withBranchContext, requireArea('returns')] as const;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(ReturnStatus).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const createBody = z
  .object({
    orderId: z.string().min(1),
    reason: z.string().trim().min(1, 'Explain why this is being returned').max(500),
    // Optional: alongside `reason`, not a replacement for it — a fixed bucket
    // for analytics, distinct from asking someone to describe the problem in
    // their own words. Optional so an older client that doesn't send it yet
    // keeps working exactly as before.
    category: z.nativeEnum(ReturnCategory).optional(),
    items: z
      .array(
        z.object({
          orderItemId: z.string().min(1),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1, 'Select at least one item to return'),
  })
  .strict();

const rejectBody = z
  .object({
    rejectionReason: z
      .string()
      .trim()
      .min(1, 'Explain why this return is being rejected')
      .max(500),
  })
  .strict();

const approveBody = z
  .object({
    // NONE is not offered — approving without deciding what happens for the
    // customer is not a real approval.
    resolution: z.enum([
      ReturnResolution.REFUND,
      ReturnResolution.STORE_CREDIT,
      ReturnResolution.REPLACEMENT,
    ]),
    refundAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 49.99')
      .optional(),
    restock: z.boolean(),
    /**
     * Per-line decisions (B4.7 / B4.8). Omit to accept every line in full —
     * what approving a return has always meant, so an older client keeps
     * working unchanged.
     */
    items: z
      .array(
        z.object({
          returnItemId: z.string().trim().min(1),
          accepted: z.boolean(),
          /** Omitted means "all of what was asked". */
          acceptedQuantity: z.number().int().positive().optional(),
          rejectionReason: z.string().trim().max(255).optional(),
        }),
      )
      .optional(),
  })
  .strict();

returnsRouter.get('/returns', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  res.json({
    data: await listReturns({ ...parsed.data, branchId: req.branchId ?? undefined }),
  });
});

returnsRouter.get('/returns/:id', ...guard, async (req, res) => {
  res.json({ data: { return: await getReturn(String(req.params.id)) } });
});

returnsRouter.post('/returns', ...guard, async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);
  const created = await createReturn(parsed.data);

  req.log.info({
    event: 'return.created',
    returnId: created.id,
    orderId: parsed.data.orderId,
    userId: user.id,
  });

  res.status(201).json({ data: { return: created } });
});

returnsRouter.post('/returns/:id/approve', ...guard, async (req, res) => {
  const parsed = approveBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);
  const id = String(req.params.id);

  const result = await approveReturn(
    id,
    // The branch the goods come back to, from the switcher (F8.2).
    { ...parsed.data, actorId: user.id, branchId: req.branchId ?? undefined },
    req,
  );

  req.log.warn({ event: 'return.approved', returnId: id, userId: user.id });

  res.json({ data: { return: result } });
});

returnsRouter.post('/returns/:id/reject', ...guard, async (req, res) => {
  const parsed = rejectBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);
  const id = String(req.params.id);

  const result = await rejectReturn(id, parsed.data.rejectionReason, req);

  req.log.warn({ event: 'return.rejected', returnId: id, userId: user.id });

  res.json({ data: { return: result } });
});
