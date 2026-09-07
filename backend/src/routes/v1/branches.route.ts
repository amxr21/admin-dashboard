import { Router } from 'express';
import { StaffRole } from '@prisma/client';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea, requireRole } from '../../middleware/authorize.js';
import { effectiveRole, withBranchContext } from '../../middleware/branch-context.js';
import {
  createBranch,
  createBusiness,
  getBranch,
  listBranchesFor,
  listBusinesses,
  resolveBrand,
  updateBranch,
  updateBusiness,
} from '../../services/branches.service.js';
import { getSettingValue } from '../../services/settings.service.js';
import { audit } from '../../services/audit.service.js';

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

/* ─────────────────────────────────────────────────────────────────────
 * WRITES (O7 stage 1)
 *
 * ─── WHY THESE ARE `requireRole`, NOT `requireArea('settings')` ──────
 * Every other write on this router sits behind the `settings` area, and
 * MANAGER holds `settings` today. But reaching the settings PAGE does not
 * imply "may open a shop": creating a business or a branch changes the
 * org chart, decides where stock and revenue are attributed, and is the
 * single act this whole track exists to enable. It is owner-shaped.
 *
 * So these are OWNER/DEVELOPER only, which is the same pair
 * `isBusinessWideRole` already treats as business-wide for branch scoping —
 * one definition of "may act across the whole business", not two.
 *
 * This is deliberately the narrow choice. Widening it later is a one-line
 * change with an audit trail behind it; discovering that a MANAGER quietly
 * opened a branch and started attributing revenue to it is not.
 * ───────────────────────────────────────────────────────────────────── */

const businessSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(60).nullish(),
  legalName: z.string().trim().max(200).nullish(),
  taxId: z.string().trim().max(60).nullish(),
  email: z.string().trim().email().max(255).nullish(),
  phone: z.string().trim().max(40).nullish(),
  addressLine: z.string().trim().max(255).nullish(),
  city: z.string().trim().max(120).nullish(),
  country: z.string().trim().length(2).nullish(),
  currency: z.string().trim().length(3).nullish(),
  timezone: z.string().trim().max(64).nullish(),
  logoUrl: z.string().trim().max(512).nullish(),
  isActive: z.boolean().optional(),
});

/** The fields a branch write accepts, on top of `detailSchema`. */
const branchCreateSchema = detailSchema.extend({
  businessId: z.string().trim().min(1),
  isDefault: z.boolean().optional(),
});

/**
 * A field-level diff, in the shape `audit()` expects.
 *
 * Only changed fields are recorded: an audit entry listing every field of a
 * record whether or not it moved buries the one thing that did.
 */
function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.entries(after)
      .filter(([key, value]) => before[key] !== value)
      .map(([key, value]) => [key, { from: before[key], to: value }]),
  );
}

/**
 * GET /api/v1/businesses — every business with its branches.
 *
 * Behind `settings` rather than the owner-only guard on the writes below:
 * seeing the org chart is a read, and a MANAGER opening the branches page to
 * check which shops exist is ordinary. Only CHANGING it is owner-shaped.
 */
branchesRouter.get(
  '/businesses',
  authenticate,
  withBranchContext,
  requireArea('settings'),
  async (_req, res) => {
    res.status(200).json({ data: await listBusinesses() });
  },
);

/** POST /api/v1/businesses — `name` is the only required field. */
branchesRouter.post(
  '/businesses',
  authenticate,
  withBranchContext,
  requireRole(StaffRole.OWNER, StaffRole.DEVELOPER),
  async (req, res) => {
    const parsed = businessSchema.safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid business details', parsed.error.flatten());
    }

    const business = await createBusiness(parsed.data);

    // Opening a company is exactly what an audit trail is for. `changes`
    // records the created values rather than a diff — there is no `from`.
    audit(req, {
      action: 'business.created',
      entity: 'business',
      entityId: business.id,
      changes: Object.fromEntries(
        Object.entries(parsed.data).map(([key, value]) => [key, { from: null, to: value }]),
      ),
    });

    res.status(201).json({ data: business });
  },
);

/**
 * PATCH /api/v1/businesses/:id.
 *
 * `.partial()` over the same schema, so a one-field correction does not have
 * to resend the record. `id` is not in the schema at all and is therefore
 * dropped rather than rejected — a client echoing the record back cannot
 * accidentally reassign the row it is editing.
 */
branchesRouter.patch(
  '/businesses/:id',
  authenticate,
  withBranchContext,
  requireRole(StaffRole.OWNER, StaffRole.DEVELOPER),
  async (req, res) => {
    const parsed = businessSchema.partial().safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid business details', parsed.error.flatten());
    }

    const { before, updated } = await updateBusiness(String(req.params.id), parsed.data);

    audit(req, {
      action: 'business.updated',
      entity: 'business',
      entityId: updated.id,
      changes: changedFields(before, parsed.data),
    });

    res.status(200).json({ data: updated });
  },
);

/**
 * POST /api/v1/branches — open a shop.
 *
 * A WAREHOUSE IS `isSellingPoint: false`, not a separate concept and not a
 * separate endpoint. It holds stock and takes no orders; everything else
 * about it is a branch, and modelling it twice would mean every query that
 * means "somewhere stock can be" had to remember to union two tables.
 */
branchesRouter.post(
  '/branches',
  authenticate,
  withBranchContext,
  requireRole(StaffRole.OWNER, StaffRole.DEVELOPER),
  async (req, res) => {
    const parsed = branchCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid branch details', parsed.error.flatten());
    }

    const branch = await createBranch(parsed.data);

    audit(req, {
      action: 'branch.created',
      entity: 'branch',
      entityId: branch.id,
      changes: Object.fromEntries(
        Object.entries({ ...parsed.data, isDefault: branch.isDefault }).map(([key, value]) => [
          key,
          { from: null, to: value },
        ]),
      ),
    });

    res.status(201).json({ data: branch });
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
    const parsed = detailSchema
      .extend({ isDefault: z.boolean().optional() })
      .partial()
      .safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid branch details', parsed.error.flatten());
    }

    const { before, updated } = await updateBranch(String(req.params.id), parsed.data);

    audit(req, {
      action: 'branch.updated',
      entity: 'branch',
      entityId: updated.id,
      changes: changedFields(before, parsed.data),
    });

    res.status(200).json({ data: updated });
  },
);
