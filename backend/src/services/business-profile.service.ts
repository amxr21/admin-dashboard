import { prisma } from '../db/prisma.js';
import { getSettingValue } from './settings.service.js';
import { resolveBrand, type BrandSource } from './branches.service.js';

/**
 * The business/brand profile an EXTERNAL system imports (D2).
 *
 * ─── WHAT THIS IS FOR ────────────────────────────────────────────────
 * Another dashboard wants to show this business's identity — its name, logo,
 * tagline, accent colour, where to reach it, and which branches exist. It
 * authenticates with an admin-created API key (see `api-key.service.ts`) and
 * reads this one endpoint instead of being handed a copy of the settings
 * registry.
 *
 * ─── WHY IT IS A HAND-WRITTEN ALLOWLIST, NOT A PROJECTION ────────────
 * The obvious implementation is "read the `store.*` settings and return
 * them". That is exactly what this must NOT do, and the reason is the
 * registry's own growth: `store.*` currently holds a tax id, and the next
 * person to add a brand-ish setting under that prefix would silently widen
 * this endpoint's payload to an external integrator with no review step and
 * no test failure. The same argument `storefront.service.ts` makes for
 * `getStorefrontConfig` returning three named fields rather than the
 * registry.
 *
 * So every field below is named individually. Adding one is a deliberate
 * edit to this file, which is the point.
 *
 * ─── WHY IT REUSES `resolveBrand` ────────────────────────────────────
 * `branches.service.ts` already owns the branch -> business -> setting
 * fallback chain, including the "an empty string means not set" rule that
 * makes an unfilled business field lose to a filled-in setting. Re-deriving
 * that precedence here would produce a second answer to "what is this
 * store's name" that could disagree with the invoice letterhead.
 *
 * This endpoint is not branch-scoped — an external integrator has no branch
 * context and no `X-Branch-Id` header — so it passes `null`, which
 * `resolveBrand` short-circuits straight to the settings-level fallback.
 * Passing the settings through it anyway (rather than reading them directly)
 * keeps the two surfaces on one code path, so a later change to the chain
 * cannot move the invoice and leave this behind.
 */

export interface BusinessProfileBranch {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  /** False for a warehouse or prep kitchen — it holds stock but takes no
   *  orders. An integrator rendering "our locations" wants to filter on this
   *  rather than guess from the name. */
  isSellingPoint: boolean;
}

export interface BusinessProfile {
  name: string;
  legalName: string | null;
  tagline: string;
  logoUrl: string;
  /** The store's own customer-facing site, if it has one. */
  websiteUrl: string;
  /** A hex colour from the curated palette (`ACCENT_COLOR_PALETTE`), so an
   *  importing dashboard can match this business's branding rather than
   *  inventing one. */
  accentColor: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  /** ISO 4217 (AED, USD). Formatting only — it converts nothing. */
  currency: string;
  branches: BusinessProfileBranch[];
}

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const [
    storeName,
    storeAddress,
    storeSupportEmail,
    storeSupportPhone,
    storeTaxId,
    storeLogoUrl,
    storeCurrency,
    tagline,
    websiteUrl,
    accentColor,
  ] = await Promise.all([
    getSettingValue('store.name'),
    getSettingValue('store.address'),
    getSettingValue('store.supportEmail'),
    getSettingValue('store.supportPhone'),
    getSettingValue('store.taxId'),
    getSettingValue('store.logoUrl'),
    getSettingValue('store.currency'),
    getSettingValue('store.tagline'),
    getSettingValue('store.url'),
    getSettingValue('theme.accentColor'),
  ]);

  const settingsBrand: BrandSource = {
    storeName: String(storeName),
    storeAddress: String(storeAddress),
    storeSupportEmail: String(storeSupportEmail),
    storeSupportPhone: String(storeSupportPhone),
    // Carried only because `BrandSource` requires it — deliberately NOT
    // returned. See the exclusion note below.
    storeTaxId: String(storeTaxId),
    storeLogoUrl: String(storeLogoUrl),
    storeCurrency: String(storeCurrency),
  };

  /**
   * The primary business, and it may legitimately not exist.
   *
   * A single-shop install that never opened the branches page has zero
   * `Business` rows and runs entirely on the settings registry. That is a
   * supported state, not a misconfiguration, so this resolves to the
   * settings-level brand rather than 404ing — an integrator asking "who are
   * you" should get an answer from a working install.
   *
   * `isDefault` picks the branch, and its business is the primary one. The
   * flag exists precisely because ordering by `createdAt` returned the wrong
   * row on a machine offset from UTC (see `Branch.isDefault`'s schema
   * comment), so it is read here rather than re-deriving "the oldest".
   */
  const defaultBranch = await prisma.branch.findFirst({
    where: { isActive: true, isDefault: true, business: { isActive: true } },
    select: { businessId: true },
  });

  const business = defaultBranch
    ? await prisma.business.findUnique({
        where: { id: defaultBranch.businessId },
        select: { id: true, name: true, legalName: true },
      })
    : await prisma.business.findFirst({
        where: { isActive: true },
        select: { id: true, name: true, legalName: true },
        orderBy: { name: 'asc' },
      });

  // Branch-level detail is deliberately not applied: `resolveBrand(null, …)`
  // returns the settings fallback, and the business-level overlay is applied
  // by reading the business row above. An external integrator is asking about
  // the business as a whole, not about one till's letterhead.
  const brand = await resolveBrand(null, settingsBrand);

  const branches = business
    ? await prisma.branch.findMany({
        where: { businessId: business.id, isActive: true },
        select: { id: true, name: true, code: true, city: true, isSellingPoint: true },
        orderBy: { name: 'asc' },
      })
    : [];

  return {
    // The trading name is what an external dashboard displays. `legalName` is
    // returned alongside rather than instead of it — the invoice rule
    // (legalName wins, because it owns the tax id) is specific to a tax
    // document and would show the wrong name on a storefront header.
    name: business?.name.trim() || brand.storeName,
    legalName: business?.legalName?.trim() || null,
    tagline: String(tagline),
    logoUrl: brand.storeLogoUrl,
    websiteUrl: String(websiteUrl),
    accentColor: String(accentColor),
    address: brand.storeAddress,
    supportEmail: brand.storeSupportEmail,
    supportPhone: brand.storeSupportPhone,
    currency: brand.storeCurrency,
    branches,
  };
}
