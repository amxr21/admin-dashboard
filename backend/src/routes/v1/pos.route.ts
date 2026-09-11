import { StaffRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { effectiveRole, withBranchContext } from '../../middleware/branch-context.js';
import { verifyOverrideToken } from '../../services/auth.service.js';
import {
  browseCategories,
  browseProducts,
  checkout,
  discardParkedSale,
  listParkedSales,
  parkSale,
  resumeParkedSale,
  scanProduct,
  searchPosCustomers,
  voidSale,
} from '../../services/pos.service.js';
import { getOpenShift } from '../../services/shifts.service.js';
import { productLocaleFromHeader } from '../../services/product-content.service.js';

/**
 * The till (O5).
 *
 * ─── GUARDED BY `orders`, NOT `inventory` ────────────────────────────
 * A scan is the first step of taking an order, not of managing stock. Putting
 * it behind `inventory` would mean the person on the till needs stock-editing
 * rights to sell a coffee — more authority than the job needs, and the
 * opposite of what O4 is trying to correct.
 *
 * When the `CASHIER` role lands (O5.10) it gets `orders`, and this works
 * unchanged.
 */

export const posRouter = Router();

const guard = [authenticate, withBranchContext, requireArea('orders')] as const;

const scanQuery = z.object({
  // Long enough for any real EAN/UPC/SKU; a longer string is a paste
  // accident, not a scan.
  code: z.string().trim().min(1).max(64),
});

/**
 * GET /api/v1/pos/scan?code=... — the one product carrying this code.
 *
 * A GET because it reads. 404 when nothing matches, with the code echoed
 * back: at a till the usual cause is a mis-scan, and seeing what was actually
 * read is how somebody notices a dropped digit.
 */
posRouter.get('/pos/scan', ...guard, async (req, res) => {
  const parsed = scanQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Scan or type a code', parsed.error.flatten());
  }

  // Stock is reported for the branch the till is standing in — the number the
  // cashier can actually reach. `withBranchContext` resolves it from the
  // switcher's header.
  const product = await scanProduct(
    parsed.data.code,
    req.branchId ?? null,
    productLocaleFromHeader(req.get('accept-language')),
  );

  res.status(200).json({ data: { product } });
});

const browseQuery = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().trim().min(1).optional(),
  /** Resuming a parked cart (O9.12b) — comma-separated product ids to fetch
   *  by identity rather than by search. */
  ids: z.string().trim().min(1).optional(),
});

/**
 * GET /api/v1/pos/browse?q=&categoryId= — the grid a cashier taps instead of
 * scanning (O9.10).
 *
 * The owner confirmed the shop will not be barcoding its stock, so this is
 * the PRIMARY way a cashier finds most of the catalogue, not a fallback —
 * `/pos/scan` stays exactly as exact as it was for the few products that do
 * carry a code.
 */
posRouter.get('/pos/browse', ...guard, async (req, res) => {
  const parsed = browseQuery.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid search', parsed.error.flatten());
  }

  const products = await browseProducts({
    q: parsed.data.q,
    categoryId: parsed.data.categoryId,
    branchId: req.branchId ?? null,
    ids: parsed.data.ids
      ? parsed.data.ids.split(',').map((id) => id.trim()).filter(Boolean)
      : undefined,
    locale: productLocaleFromHeader(req.get('accept-language')),
  });

  res.status(200).json({ data: { products } });
});

/**
 * GET /api/v1/pos/browse/categories — the grid's tabs.
 *
 * A separate endpoint rather than nesting under `/browse` itself: the
 * category list does not change per keystroke the way the product grid does,
 * so the two have different natural refetch rates and belong in different
 * requests.
 */
posRouter.get('/pos/browse/categories', ...guard, async (_req, res) => {
  const categories = await browseCategories();

  res.status(200).json({ data: { categories } });
});

const customerSearchQuery = z.object({
  q: z.string().trim().min(2).max(120),
});

posRouter.get('/pos/customers', ...guard, async (req, res) => {
  const parsed = customerSearchQuery.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.badRequest('Enter at least two characters', parsed.error.flatten());
  }
  res.json({ data: { customers: await searchPosCustomers(parsed.data.q) } });
});

const checkoutSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
        // Range checked again in the service (0-100) — Zod only proves it
        // is A number here; the service is where the cap comparison and
        // the manager-approval requirement actually live.
        discountPercent: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    // A basket bigger than this is a script, not a shopper.
    .max(200),
  // Optional here — send either this or `splitPayments`, not both; the
  // service is where "exactly one of the two" is actually enforced, since
  // Zod validating shape and the service validating "the RIGHT one of two
  // shapes for this sale" are different questions.
  method: z.string().trim().min(1).max(48).optional(),
  /** Cash handed over, as a string — money never crosses as a float. */
  tendered: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 20.00')
    .optional(),
  /** Split payment (O9 Tier 3) — 30 cash, rest on card. Each entry becomes
   *  its own `Payment` row; amounts must sum to the sale total exactly,
   *  checked in the service once the real total is known. */
  splitPayments: z
    .array(
      z.object({
        method: z.string().trim().min(1).max(48),
        amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 20.00'),
        tendered: z
          .string()
          .trim()
          .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 20.00')
          .optional(),
        reference: z.string().trim().max(120).optional(),
      }),
    )
    .min(2)
    .max(6)
    .optional(),
  /**
   * `shiftId` is deliberately NOT accepted here (O9.17).
   *
   * It used to be, and it was written onto the `Payment` row unverified —
   * nothing checked the shift existed, was still open, or belonged to the
   * caller. The drawer is reconciled by summing the payments carrying a
   * shift id, so a wrong value silently moved cash into somebody else's
   * count and `closeTill` then computed a variance against a figure that was
   * never that cashier's.
   *
   * The realistic path was not an attack: the sale screen read the shift once
   * on mount and held it for the life of the page, so a cashier who clocked
   * out and handed the terminal over without a reload kept posting the
   * PREVIOUS person's id. Resolving it server-side from the authenticated
   * user removes the id from the client's hands entirely, and the stale-page
   * case disappears with it.
   */
  customerId: z.string().trim().min(1).optional(),
  note: z.string().trim().max(255).optional(),
  /** The card terminal's own receipt/reference number (O9.10 follow-up) —
   *  optional, since not every terminal prints one and cash never has one.
   *  Stored so a disputed charge can be matched back to this sale later. */
  reference: z.string().trim().max(120).optional(),
  /** Proof a manager approved a discount above the cap (O9.13) — verified
   *  server-side against the signature, never trusted as a bare claim. */
  overrideToken: z.string().trim().min(1).optional(),
  /** Exchange (O9.8) — the return this sale is the replacement for. Ordinary
   *  sale otherwise; the service validates the return exists, is resolved as
   *  REPLACEMENT, and is not already linked before writing the connection. */
  exchangeReturnId: z.string().trim().min(1).optional(),
});

const idempotencyKeySchema = z.string().uuid().max(64);

/**
 * POST /api/v1/pos/checkout — take a sale.
 *
 * The first endpoint in this app that creates an order. Everything it touches
 * — the order, its lines, the stock movements, the payment — commits in one
 * transaction: a sale that recorded the money but not the stock leaves books
 * and shelves disagreeing with nothing to say which half happened.
 */
posRouter.post('/pos/checkout', ...guard, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid sale', parsed.error.flatten());
  }

  const parsedIdempotencyKey = idempotencyKeySchema.safeParse(
    req.get('Idempotency-Key'),
  );

  if (!parsedIdempotencyKey.success) {
    throw AppError.badRequest('A valid Idempotency-Key header is required', {
      field: 'Idempotency-Key',
    });
  }

  const user = requireUser(req);

  // Whose drawer this sale belongs to is decided HERE, from the token —
  // never from the body. `actorId` was already derived this way; `shiftId`
  // sitting next to it in the same write while being client-supplied is what
  // made the inconsistency easy to miss on review.
  //
  // No open shift is not an error: an owner ringing up a sale outside any
  // session is real, and that payment simply belongs to no drawer.
  const openShift = await getOpenShift(user.id);

  const execution = await checkout(
    {
      ...parsed.data,
      branchId: req.branchId ?? undefined,
      shiftId: openShift?.id,
    },
    user.id,
    req,
    parsedIdempotencyKey.data,
  );

  res.set('Idempotency-Replayed', execution.replayed ? 'true' : 'false');
  res.status(201).json({ data: execution.value });
});

const voidSchema = z.object({
  /** Proof a manager approved (O9 Tier 3) — required when the caller is a
   *  cashier, ignored otherwise. Same mechanism as the discount and returns
   *  overrides: verified against the signature, never a bare claim. */
  overrideToken: z.string().trim().min(1).optional(),
});

/**
 * POST /api/v1/pos/orders/:orderId/void
 *
 * Distinct from a return: same sale, undone at the same register, moments
 * later — see `voidSale`'s own doc comment. Reversing a completed sale is
 * exactly the kind of thing a cashier should not do unsupervised, the same
 * reasoning O9.7 already applied to approving a return.
 */
posRouter.post('/pos/orders/:orderId/void', ...guard, async (req, res) => {
  const parsed = voidSchema.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);
  const orderId = String(req.params.orderId);

  if (effectiveRole(req) === StaffRole.CASHIER) {
    if (!parsed.data.overrideToken) {
      throw AppError.forbidden('A manager needs to approve this in place');
    }

    if (!verifyOverrideToken(parsed.data.overrideToken)) {
      throw AppError.forbidden('The manager approval could not be verified');
    }
  }

  const result = await voidSale(orderId, user.id, req);

  res.json({ data: result });
});

/* ─────────────────────────────────────────────────────────────────────
 * PARK / RESUME A SALE (O9.12b)
 * ───────────────────────────────────────────────────────────────────── */

const parkLineSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  discountPercent: z.number().min(0).max(100).optional(),
});

const parkSchema = z.object({
  lines: z.array(parkLineSchema).min(1),
  label: z.string().trim().max(100).optional(),
});

/** POST /api/v1/pos/parked — set the current cart aside. */
posRouter.post('/pos/parked', ...guard, async (req, res) => {
  const parsed = parkSchema.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  const user = requireUser(req);

  if (!req.branchId) {
    throw AppError.badRequest('No branch is in context — choose one before parking a cart');
  }

  const result = await parkSale(user.id, req.branchId, parsed.data.lines, parsed.data.label);

  res.status(201).json({ data: result });
});

/** GET /api/v1/pos/parked — this cashier's own parked carts at this branch. */
posRouter.get('/pos/parked', ...guard, async (req, res) => {
  const user = requireUser(req);

  if (!req.branchId) {
    res.json({ data: [] });
    return;
  }

  const result = await listParkedSales(user.id, req.branchId);

  res.json({ data: result });
});

/** POST /api/v1/pos/parked/:id/resume — bring it back and forget it was parked. */
posRouter.post('/pos/parked/:id/resume', ...guard, async (req, res) => {
  const user = requireUser(req);
  const result = await resumeParkedSale(String(req.params.id), user.id);

  res.json({ data: result });
});

/** DELETE /api/v1/pos/parked/:id — give up on it, the customer never came back. */
posRouter.delete('/pos/parked/:id', ...guard, async (req, res) => {
  const user = requireUser(req);
  await discardParkedSale(String(req.params.id), user.id);

  res.status(204).send();
});
