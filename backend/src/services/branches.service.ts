import { StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { isBusinessWideRole } from './branch-roles.service.js';

/**
 * Businesses and branches as records an owner actually manages (F8.5).
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────
 * It does not replace `Setting`. The store-wide settings stay exactly where
 * they are and keep their meaning — see `resolveBrand` below for the split,
 * which is the real decision this stage had to make.
 */

/**
 * Which branches this person may switch to.
 *
 * ─── WHY THE LIST IS AUTHORISATION, NOT CONVENIENCE ──────────────────
 * The switcher's contents ARE the set of branches a user can act on, because
 * picking one sets the `X-Branch-Id` header that `withBranchContext` resolves
 * against. Returning a branch here that the person has no business seeing
 * would not merely clutter a dropdown — it would advertise the existence of
 * another business's branch, and its name usually IS the business.
 *
 * So: a business-wide role (OWNER/DEVELOPER) sees every active branch; anyone
 * else sees only branches they hold an explicit `UserBranch` row at.
 *
 * A user with a global role but no assignments sees NOTHING here, and that is
 * correct rather than a bug: they can still work unscoped (the header is
 * optional, and every unscoped request answers for the whole business as it
 * always did), but they have not been placed anywhere in particular.
 */
export async function listBranchesFor(userId: string, role: StaffRole) {
  const branches = await prisma.branch.findMany({
    where: {
      isActive: true,
      business: { isActive: true },
      // An explicit assignment is required for everyone except the two
      // business-wide roles. `some` on an empty relation is false, which is
      // the safe default: no assignment means no branch, never every branch.
      ...(isBusinessWideRole(role) ? {} : { staff: { some: { userId } } }),
    },
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      isSellingPoint: true,
      isDefault: true,
      business: { select: { id: true, name: true } },
    },
    orderBy: [{ business: { name: 'asc' } }, { name: 'asc' }],
  });

  return branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    code: branch.code,
    city: branch.city,
    isSellingPoint: branch.isSellingPoint,
    isDefault: branch.isDefault,
    businessId: branch.business.id,
    businessName: branch.business.name,
  }));
}

/** One branch, with the business it belongs to. Used by the detail form. */
export async function getBranch(branchId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { business: true },
  });

  if (!branch) throw AppError.notFound('Branch not found');

  return branch;
}

/**
 * The brand shown on an invoice, a letterhead or the browser tab.
 *
 * ─── THE F8.5 DECISION: WHAT MOVES OUT OF `Setting`, AND WHAT DOES NOT ──
 * Several `store.*` settings duplicate fields that now exist on `Business`:
 * name, address, tax id, currency, logo, support email and phone. That is two
 * sources of truth for the same fact, and the invoice letterhead reads the
 * settings — so on a two-business install, one business's invoice would print
 * the OTHER business's name, address and tax id. Silently, and on a legal
 * document.
 *
 * The fix is NOT to delete the settings. They are the correct answer for a
 * single-business install, which is every install today, and removing them
 * would break every existing deployment to solve a problem those deployments
 * do not have.
 *
 * So the rule is a FALLBACK CHAIN, narrowest first:
 *
 *     branch  ->  business  ->  store-wide setting
 *
 * A branch may override an address (it has its own). A business may override
 * everything (it is a different company). Anything neither has falls through
 * to the setting, exactly as it does now.
 *
 * That makes this stage additive: an install with one business and no branch
 * detail filled in behaves identically to before, and an owner who fills in a
 * second business gets correct invoices without touching their settings.
 *
 * An empty string counts as "not set". The settings registry uses `''` as the
 * declared default for every one of these, so treating it as a real value
 * would make an unfilled business field beat a filled-in setting.
 */
export interface BrandSource {
  storeName: string;
  storeAddress: string;
  storeSupportEmail: string;
  storeSupportPhone: string;
  storeTaxId: string;
  storeLogoUrl: string;
  storeCurrency: string;
}

function firstFilled(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    if (value !== null && value !== undefined && value.trim() !== '') return value;
  }
  return '';
}

export async function resolveBrand(
  branchId: string | null,
  fallback: BrandSource,
): Promise<BrandSource> {
  if (!branchId) return fallback;

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      addressLine: true,
      city: true,
      phone: true,
      business: {
        select: {
          name: true,
          legalName: true,
          addressLine: true,
          city: true,
          email: true,
          phone: true,
          taxId: true,
          logoUrl: true,
          currency: true,
        },
      },
    },
  });

  if (!branch) return fallback;

  const business = branch.business;

  // A branch address is only meaningful WITH its city, and the business's own
  // address is a different place — so the two are never mixed line by line.
  const branchAddress = firstFilled(
    [branch.addressLine, branch.city].filter((part) => part?.trim()).join(', '),
  );
  const businessAddress = firstFilled(
    [business.addressLine, business.city].filter((part) => part?.trim()).join(', '),
  );

  return {
    // `legalName` wins over the trading name on an invoice: it is the entity
    // the tax id belongs to, and the two must not disagree on one document.
    storeName: firstFilled(business.legalName, business.name, fallback.storeName),
    storeAddress: firstFilled(branchAddress, businessAddress, fallback.storeAddress),
    storeSupportEmail: firstFilled(business.email, fallback.storeSupportEmail),
    storeSupportPhone: firstFilled(branch.phone, business.phone, fallback.storeSupportPhone),
    storeTaxId: firstFilled(business.taxId, fallback.storeTaxId),
    storeLogoUrl: firstFilled(business.logoUrl, fallback.storeLogoUrl),
    storeCurrency: firstFilled(business.currency, fallback.storeCurrency),
  };
}
