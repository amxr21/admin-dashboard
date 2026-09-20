import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
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
 * Integrators use the same `X-Branch-Id` context as staff sessions. It
 * selects the business and applies the branch -> business -> settings chain.
 * An unscoped call is accepted only with zero or one active business; several
 * businesses require an explicit branch instead of a default/first-row guess.
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

async function resolveProfileBusiness(branchId?: string) {
  if (branchId) {
    const selected = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true, business: { isActive: true } },
      select: { business: { select: { id: true, name: true, legalName: true } } },
    });
    if (!selected) throw AppError.notFound('Branch context is unavailable');
    return selected.business;
  }

  const candidates = await prisma.business.findMany({
    where: { isActive: true },
    select: { id: true, name: true, legalName: true },
    orderBy: { name: 'asc' },
    take: 2,
  });

  if (candidates.length > 1) {
    throw AppError.badRequest('Select a branch to choose which business profile to read', {
      field: 'branchId',
      reason: 'BRANCH_REQUIRED_MULTIPLE_BUSINESSES',
    });
  }

  // Zero businesses is the supported pre-setup/settings-only state.
  return candidates[0] ?? null;
}

export async function getBusinessProfile(branchId?: string): Promise<BusinessProfile> {
  // Resolve ownership before reading even allowlisted profile settings. This
  // keeps an ambiguous or unknown scope fail-closed at the service boundary.
  const business = await resolveProfileBusiness(branchId);
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

  // A scoped profile follows the same branch -> business -> settings brand
  // chain as invoices. The unscoped compatibility path uses settings only.
  const brand = await resolveBrand(branchId ?? null, settingsBrand);

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
