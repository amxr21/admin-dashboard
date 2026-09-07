import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { effectiveRole, withBranchContext } from '../../middleware/branch-context.js';
import { getBranch, listBranchesFor, resolveBrand } from '../../services/branches.service.js';
import { getSettingValue } from '../../services/settings.service.js';
import { audit } from '../../services/audit.service.js';
import { prisma } from '../../db/prisma.js';

/**
 * Branches and businesses (F8.5).
 *
 * ─── WHY `GET /branches` IS NOT BEHIND `requireArea` ─────────────────
 * Every authenticated user needs to know which branches they may switch to —
 * a FULFILLMENT user has no `settings` access and still has to pick where
 * they are working. The list is already scoped to what the caller may reach
 * (see `listBranchesFor`), so the authorisation is in the query rather than a
 * gate in front of it.
 *
 * Writes are a different matter and DO sit behind `settings`: creating or
 * editing a branch is an owner-shaped act, not a daily one.
 */

export const branchesRouter = Router();

const detailSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(24).nullish(),
  addressLine: z.string().trim().max(255).nullish(),
  city: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(40).nullish(),
  timezone: z.string().trim().max(64).nullish(),
  isSellingPoint: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/v1/branches — what this person may switch to.
 *
 * Not paginated on purpose. A branch list is a switcher, and a business with
 * enough branches to need paging has a different problem than this endpoint.
 */
branchesRouter.get('/branches', authenticate, withBranchContext, async (req, res) => {
  const user = requireUser(req);

  const branches = await listBranchesFor(user.id, effectiveRole(req));

  res.status(200).json({ data: branches });
});

/**
 * GET /api/v1/branches/_brand — the name, address and tax id to PRINT.
 *
 * ─── WHY THIS IS AN ENDPOINT AND NOT A CLIENT-SIDE MERGE ─────────────
 * The fallback chain (branch -> business -> store setting) has to have ONE
 * implementation. Done in the frontend it would be duplicated across the
 * invoice, the tab title and the sidebar, and the copy that drifted would
 * print a wrong tax id on a legal document without anything failing.
 *
 * Resolved against the ACTIVE branch, so the answer follows the switcher.
 * With no active branch it returns the store-wide settings unchanged, which
 * is exactly what a single-business install has always shown.
 *
 * Behind `authenticate` only: every signed-in user renders a letterhead
 * somewhere, and none of these fields is more sensitive than the store name
 * already on screen.
 */
branchesRouter.get('/branches/_brand', authenticate, withBranchContext, async (req, res) => {
  // `getSettingValue` per key rather than a bulk read: it is the typed
  // accessor, and it already applies the registry's declared default when a
  // row was never written — which is what makes an unfilled setting an empty
  // string here rather than undefined.
  const [name, address, supportEmail, supportPhone, taxId, logoUrl, currency] = await Promise.all([
    getSettingValue('store.name'),
    getSettingValue('store.address'),
    getSettingValue('store.supportEmail'),
    getSettingValue('store.supportPhone'),
    getSettingValue('store.taxId'),
    getSettingValue('store.logoUrl'),
    getSettingValue('store.currency'),
  ]);

  const brand = await resolveBrand(req.branchId ?? null, {
    storeName: String(name),
    storeAddress: String(address),
    storeSupportEmail: String(supportEmail),
    storeSupportPhone: String(supportPhone),
    storeTaxId: String(taxId),
    storeLogoUrl: String(logoUrl),
    storeCurrency: String(currency),
  });

  res.status(200).json({ data: brand });
});

/** GET /api/v1/branches/:id — one branch with its business, for the form. */
branchesRouter.get(
  '/branches/:id',
  authenticate,
  withBranchContext,
  requireArea('settings'),
  async (req, res) => {
    const branch = await getBranch(String(req.params.id));

    res.status(200).json({ data: branch });
  },
);

/**
 * PATCH /api/v1/branches/:id — "every detail of the shop".
 *
 * Deliberately does not accept `businessId`: moving a branch between
 * businesses would take its orders and stock with it, silently re-attributing
 * revenue that has already been reported. If that is ever wanted it needs its
 * own endpoint that says so.
 */
branchesRouter.patch(
  '/branches/:id',
  authenticate,
  withBranchContext,
  requireArea('settings'),
  async (req, res) => {
    const parsed = detailSchema.partial().safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid branch details', parsed.error.flatten());
    }

    const id = String(req.params.id);
    const before = await getBranch(id);

    const updated = await prisma.branch.update({
      where: { id },
      data: parsed.data,
    });

    audit(req, {
      action: 'branch.updated',
      entity: 'branch',
      entityId: id,
      changes: Object.fromEntries(
        Object.entries(parsed.data)
          .filter(([key, value]) => before[key as keyof typeof before] !== value)
          .map(([key, value]) => [key, { from: before[key as keyof typeof before], to: value }]),
      ),
    });

    res.status(200).json({ data: updated });
  },
);
