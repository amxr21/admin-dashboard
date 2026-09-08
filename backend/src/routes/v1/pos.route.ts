import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import { scanProduct } from '../../services/pos.service.js';

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
