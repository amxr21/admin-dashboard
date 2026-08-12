import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { search } from '../../services/search.service.js';

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

searchRouter.get('/search', authenticate, async (req, res) => {
  const user = requireUser(req);
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid query', parsed.error.flatten());
  }

  const data = await search(user.role, parsed.data.q);
  res.status(200).json({ data });
});
