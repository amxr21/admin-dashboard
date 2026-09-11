import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { effectiveRole, withBranchContext } from '../../middleware/branch-context.js';
import { search } from '../../services/search.service.js';
import { productLocaleFromHeader } from '../../services/product-content.service.js';

/**
 * Cross-entity search (C4.2) — orders, customers, products, backing the
 * frontend's global search box. No `requireArea` guard on the route itself:
 * every caller may HIT this endpoint, but each category inside it is gated
 * independently by the caller's own areas (see search.service.ts) — a role
 * with none of the three grants gets a 200 with three empty arrays, the same
 * honest shape the generic resource schema endpoint uses for a resource a
 * role can't reach, rather than a 403 for a request that is not itself
 * asking for anything specific.
 */

export const searchRouter = Router();

const querySchema = z.object({
  q: z.string().trim().max(120),
});

searchRouter.get('/search', authenticate, withBranchContext, async (req, res) => {
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  // The role AT THE ACTIVE BRANCH (F8.4). Global search returns real rows from
  // every area the caller can reach, so searching with the global role would
  // hand back records from areas they cannot open at this branch — a read
  // path around the area guard, and one nobody would think to check.
  const data = await search(
    effectiveRole(req),
    parsed.data.q,
    req.branchId ?? null,
    productLocaleFromHeader(req.get('accept-language')),
  );
  res.status(200).json({ data });
});
