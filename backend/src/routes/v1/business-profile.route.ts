import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { authenticate } from '../../middleware/authenticate.js';
import { getBusinessProfile } from '../../services/business-profile.service.js';

/**
 * The business/brand profile an external dashboard imports (D2).
 *
 * ─── AUTHENTICATION: NOTHING NEW ─────────────────────────────────────
 * This mounts the ordinary `authenticate` middleware, which ALREADY accepts
 * an API key: it forks on the `adk_` prefix and resolves the key to its
 * owning user (see `authenticateViaApiKey`). So an integrator sends
 * `Authorization: Bearer adk_…` and a staff browser session reaches the same
 * endpoint with its JWT, through one code path.
 *
 * Adding a second, key-only middleware here would have been the mistake: two
 * ways to establish identity is two places for "is this account still
 * active" to drift apart, and `authenticate` already enforces deactivation,
 * expiry, maintenance mode and the IP allowlist for both credential types.
 *
 * ─── WHY THERE IS NO `requireArea` ───────────────────────────────────
 * Same reasoning as `GET /branches`: this returns the business's own public
 * identity — the name, logo and tagline it prints on invoices and shows
 * customers. Every authenticated role already sees all of it in the shell.
 * Gating it on `settings` would mean an integration key created by a
 * FULFILLMENT account could not read the shop's name, while that same person
 * reads it off their own sidebar.
 *
 * That said, a key here is still its OWNER — see the D3 note in the report
 * and `api-key.service.ts`'s header. A key is a credential for a person, so
 * the person's account being deactivated revokes it, which is the property
 * that actually matters for an integration.
 */

export const businessProfileRouter = Router();

/**
 * An integration polls; a browser does not. 60/minute per IP is far above any
 * legitimate import (which is a startup-time read, or a periodic refresh
 * measured in minutes) and far below what a scraper wants.
 *
 * Deliberately its own limiter rather than leaning on `apiRateLimit`: that
 * one is skipped entirely under NODE_ENV=test, and a limiter that does not
 * run in tests cannot be asserted. It is also the general backstop shared
 * with the interactive admin surface, so an integration looping on this
 * endpoint would eat the budget that keeps the dashboard responsive.
 *
 * `message` matches the errorHandler envelope so a 429 parses like every
 * other failure rather than arriving in a different shape.
 */
const businessProfileRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Slow down and try again shortly.',
    },
  },
});

/**
 * GET /api/v1/business/profile
 *
 * Identity and branding only. What is NOT here is the load-bearing part —
 * see `business-profile.service.ts` for the allowlist and why it is written
 * out field by field instead of projected from the settings registry.
 */
businessProfileRouter.get(
  '/business/profile',
  businessProfileRateLimit,
  authenticate,
  async (req, res) => {
    const profile = await getBusinessProfile();

    // Identifiers only, never the profile body — it carries a support email
    // and phone, and logging response bodies is how contact details end up in
    // log aggregation forever (the rule `public.route.ts` states at checkout).
    req.log.info({ event: 'business.profile.read', branchCount: profile.branches.length });

    res.status(200).json({ data: profile });
  },
);
