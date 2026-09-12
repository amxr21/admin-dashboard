import {
  RefundReason,
  ReturnCategory,
  ReturnResolution,
  ReturnStatus,
  StaffRole,
} from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { effectiveRole, withBranchContext } from '../../middleware/branch-context.js';
import { verifyOverrideToken } from '../../services/auth.service.js';
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
    // Same reasoning as approve's own field — deciding the OUTCOME, accept
    // or reject, is what needs a manager, not specifically the accept path.
    overrideToken: z.string().trim().min(1).optional(),
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
    /**
     * Why the refund is being given (URG-009). Optional HERE because whether
     * it is required depends on `resolution`, which the service decides — the
     * same split the refund amount above already uses.
     */
    refundReason: z
      .nativeEnum(RefundReason, { message: 'Unknown refund reason' })
      .optional(),
    refundReasonNote: z.string().trim().max(500).optional(),
    /** A restocking fee (B4.11), 0-100. Omit to use the store default. */
    restockingFeePercent: z.number().min(0).max(100).optional(),
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
    /**
     * Proof a manager approved (O9.7, O9 Tier 4) — required when the CALLER
     * is a cashier; ignored (a manager approving from their own login needs
     * no second manager to approve THEM). Verified against the signature,
     * never trusted as a bare claim — same reasoning as the till's own
     * discount override.
     */
    overrideToken: z.string().trim().min(1).optional(),
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

  /**
   * O9.7 — deciding whether a return is accepted is a manager's call, not a
   * cashier's, even though CASHIER holds the same `returns` AREA as
   * requesting one does (a cashier genuinely needs `returns` to create a
   * request; approving is the part that needs more).
   *
   * Checked against `effectiveRole`, not the global role — a per-branch
   * demotion to CASHIER (F8.4) must not leave someone approving with their
   * global MANAGER rank instead. Someone ALREADY manager-or-above here
   * needs no second manager to approve themselves; the override exists for
   * the cashier who is not one.
   */
  let approverId: string | null = null;

  if (effectiveRole(req) === StaffRole.CASHIER) {
    if (!parsed.data.overrideToken) {
      throw AppError.forbidden('A manager needs to approve this in place');
    }

    const verified = verifyOverrideToken(parsed.data.overrideToken);

    if (!verified) {
      throw AppError.forbidden('The manager approval could not be verified');
    }

    approverId = verified;
  }

  const result = await approveReturn(
    id,
    // The branch the goods come back to, from the switcher (F8.2).
    { ...parsed.data, actorId: user.id, branchId: req.branchId ?? undefined },
    req,
  );

  req.log.warn({
    event: 'return.approved',
    returnId: id,
    userId: user.id,
    ...(approverId ? { approvedByOverride: approverId } : {}),
  });

  res.json({ data: { return: result } });
});

returnsRouter.post('/returns/:id/reject', ...guard, async (req, res) => {
  const parsed = rejectBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);
  const id = String(req.params.id);

  // O9.7 — same reasoning as approve: deciding the outcome is a manager's
  // call, whichever way it goes.
  if (effectiveRole(req) === StaffRole.CASHIER) {
    if (!parsed.data.overrideToken) {
      throw AppError.forbidden('A manager needs to approve this in place');
    }

    if (!verifyOverrideToken(parsed.data.overrideToken)) {
      throw AppError.forbidden('The manager approval could not be verified');
    }
  }

  const result = await rejectReturn(id, parsed.data.rejectionReason, req);

  req.log.warn({ event: 'return.rejected', returnId: id, userId: user.id });

  res.json({ data: { return: result } });
});
