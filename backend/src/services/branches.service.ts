import { Prisma, StaffRole } from '@prisma/client';

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

/* ─────────────────────────────────────────────────────────────────────
 * WRITES (O7 stage 1)
 *
 * F8 built the engine and none of the controls: `Business`, `Branch` and
 * `UserBranch` all existed with the right columns, and nothing but a
 * migration or the seeder could create a row in any of them. An owner could
 * not open a second shop without a developer running SQL.
 *
 * These are ordinary CRUD over tables that already exist. What is NOT
 * ordinary is which of them may be refused — that is the part carrying the
 * comments below.
 * ───────────────────────────────────────────────────────────────────── */

export interface BusinessInput {
  name: string;
  kind?: string | null;
  /** Required free text when `kind` is `OTHER` (URG-021). */
  kindNote?: string | null;
  legalName?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
  currency?: string | null;
  timezone?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
}

export async function createBusiness(input: BusinessInput) {
  return prisma.business.create({ data: input });
}

/**
 * `id` is never accepted (see the route). Every other field is optional, so
 * an owner can correct one of them without resubmitting the whole record.
 */
export async function updateBusiness(businessId: string, input: Partial<BusinessInput>) {
  const before = await prisma.business.findUnique({ where: { id: businessId } });

  if (!before) throw AppError.notFound('Business not found');

  const updated = await prisma.business.update({ where: { id: businessId }, data: input });

  return { before, updated };
}

export interface BranchInput {
  businessId: string;
  name: string;
  code?: string | null;
  addressLine?: string | null;
  city?: string | null;
  phone?: string | null;
  timezone?: string | null;
  isSellingPoint?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
}

/**
 * A duplicate `code` is a 409, not a 500.
 *
 * The constraint is `@@unique([businessId, code])` — per business rather than
 * global, because two businesses may both sensibly call a branch "MAIN".
 * Prisma raises P2002, which would otherwise reach the error handler as an
 * unhandled 500 telling the owner nothing about what to change.
 */
async function translateDuplicateCode<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw AppError.conflict('A branch with this code already exists in this business', {
        field: 'code',
      });
    }
    throw error;
  }
}

/**
 * Exactly one branch carries `isDefault`, enforced in the same transaction.
 *
 * Two defaults would make `defaultBranchId()` order-dependent — returning
 * whichever row the database happened to hand back first, silently and
 * differently between queries. That is precisely the bug F8.2 fixed by
 * replacing "the oldest branch" with an explicit flag, and a second flag
 * would reintroduce it in a new disguise.
 *
 * Scoped per BUSINESS, not globally: each business needs its own default, and
 * clearing across businesses would unset an unrelated company's.
 */
async function clearOtherDefaults(
  tx: Prisma.TransactionClient,
  businessId: string,
  keepBranchId: string,
) {
  await tx.branch.updateMany({
    where: { businessId, isDefault: true, id: { not: keepBranchId } },
    data: { isDefault: false },
  });
}

export async function createBranch(input: BranchInput) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true },
  });

  if (!business) {
    throw AppError.badRequest('Business not found', { field: 'businessId' });
  }

  return translateDuplicateCode(() =>
    prisma.$transaction(async (tx) => {
      // The first branch of a business is its default whether or not the
      // caller said so. A business with branches and no default sends
      // `defaultBranchId()` back to "any active branch" — the
      // ordering-dependent answer the flag exists to replace.
      const existing = await tx.branch.count({ where: { businessId: input.businessId } });
      const isDefault = input.isDefault ?? existing === 0;

      const branch = await tx.branch.create({ data: { ...input, isDefault } });

      if (isDefault) await clearOtherDefaults(tx, input.businessId, branch.id);

      return branch;
    }),
  );
}

/**
 * Refuses to deactivate the LAST active branch of a business.
 *
 * Mirrors the last-OWNER rule in `staff.service.ts`, for the same reason:
 * `defaultBranchId()` would have nothing to fall back to, and every write
 * that records a branch — every stock movement, every order — would fail at
 * the point of sale rather than here, where the person can still understand
 * why.
 *
 * Deactivating is not deleting. The branch's stock, orders and audit history
 * are untouched and stay queryable: orders are history, and a closed shop's
 * numbers still have to explain last year's revenue.
 */
export async function updateBranch(branchId: string, input: Partial<BranchInput>) {
  const before = await prisma.branch.findUnique({ where: { id: branchId } });

  if (!before) throw AppError.notFound('Branch not found');

  if (input.isActive === false && before.isActive) {
    const remaining = await prisma.branch.count({
      where: { businessId: before.businessId, isActive: true, id: { not: branchId } },
    });

    if (remaining === 0) {
      throw AppError.badRequest(
        'This is the last active branch — a business must keep at least one',
        { field: 'isActive' },
      );
    }
  }

  const updated = await translateDuplicateCode(() =>
    prisma.$transaction(async (tx) => {
      const branch = await tx.branch.update({ where: { id: branchId }, data: input });

      if (input.isDefault === true) {
        await clearOtherDefaults(tx, before.businessId, branchId);
      }

      // Deactivating the default hands the flag on rather than leaving the
      // business without one — an inactive default is the same "nothing to
      // fall back to" problem in a quieter form.
      if (input.isActive === false && before.isDefault) {
        const heir = await tx.branch.findFirst({
          where: { businessId: before.businessId, isActive: true, id: { not: branchId } },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });

        if (heir) {
          await tx.branch.update({ where: { id: heir.id }, data: { isDefault: true } });
          await tx.branch.update({ where: { id: branchId }, data: { isDefault: false } });
        }
      }

      return tx.branch.findUniqueOrThrow({ where: { id: branch.id } });
    }),
  );

  return { before, updated };
}

/** Every business with its branches — the list page in O7 stage 3. */
export async function listBusinesses() {
  const businesses = await prisma.business.findMany({
    orderBy: { name: 'asc' },
    include: {
      branches: {
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          city: true,
          isSellingPoint: true,
          isActive: true,
          isDefault: true,
          _count: { select: { staff: true } },
        },
      },
    },
  });

  return businesses.map((business) => ({
    ...business,
    branches: business.branches.map(({ _count, ...branch }) => ({
      ...branch,
      staffCount: _count.staff,
    })),
  }));
}

/**
 * Branch names for a page of rows, in one query (O1).
 *
 * ─── WHY THIS IS A BATCH LOOKUP AND NOT AN `include` ─────────────────
 * `Order.branchId` is a plain `String?` with no Prisma relation, on purpose:
 * an order outlives the branch that took it, because a closed shop's orders
 * still explain last year's revenue. `getOrder` already resolves one this way;
 * a LIST cannot do the same per row without N queries.
 *
 * ─── WHY A MISSING BRANCH IS `null`, NEVER A GUESS ───────────────────
 * A row can have no branch for two different real reasons — it predates
 * branch scoping, or the branch was removed — and neither is "it belongs to
 * whichever branch sorts first". The caller renders nothing, which is honest;
 * inventing a name here would attribute a sale to a shop that did not make it.
 */
export interface BranchLabel {
  id: string;
  name: string;
  code: string | null;
}

export async function resolveBranchLabels(
  branchIds: (string | null | undefined)[],
): Promise<Map<string, BranchLabel>> {
  const ids = [...new Set(branchIds.filter((id): id is string => Boolean(id)))];

  if (ids.length === 0) return new Map();

  const branches = await prisma.branch.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true },
  });

  return new Map(branches.map((branch) => [branch.id, branch]));
}
