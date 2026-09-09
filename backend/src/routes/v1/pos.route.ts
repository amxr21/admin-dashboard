import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import { browseCategories, browseProducts, checkout, scanProduct } from '../../services/pos.service.js';
import { getOpenShift } from '../../services/shifts.service.js';

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
  const product = await scanProduct(parsed.data.code, req.branchId ?? null);

  res.status(200).json({ data: { product } });
});

const browseQuery = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().trim().min(1).optional(),
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
  method: z.string().trim().min(1).max(48),
  /** Cash handed over, as a string — money never crosses as a float. */
  tendered: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 20.00')
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
});

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

  const user = requireUser(req);

  // Whose drawer this sale belongs to is decided HERE, from the token —
  // never from the body. `actorId` was already derived this way; `shiftId`
  // sitting next to it in the same write while being client-supplied is what
  // made the inconsistency easy to miss on review.
  //
  // No open shift is not an error: an owner ringing up a sale outside any
  // session is real, and that payment simply belongs to no drawer.
  const openShift = await getOpenShift(user.id);

  const result = await checkout(
    {
      ...parsed.data,
      branchId: req.branchId ?? undefined,
      shiftId: openShift?.id,
    },
    user.id,
    req,
  );

  res.status(201).json({ data: result });
});
