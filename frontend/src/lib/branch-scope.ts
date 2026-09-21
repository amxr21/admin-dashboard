import type { StaffRole } from '@/config/areas';
import { fetchBranches, type BranchSummary } from '@/lib/branches-api';
import { readBranchId, writeBranchId } from '@/lib/auth-storage';

const BUSINESS_WIDE_ROLES: readonly StaffRole[] = ['DEVELOPER', 'OWNER'];

export function isBusinessWideRole(role: StaffRole): boolean {
  return BUSINESS_WIDE_ROLES.includes(role);
}

/**
 * Reconciles browser branch context with the branches the signed-in user may
 * actually enter. A branch employee with one assignment has one valid answer,
 * so requiring a hidden switcher click only creates a dead end at the till.
 * Business-wide roles retain the intentional "All branches" overview.
 */
export async function ensureBranchScope(role: StaffRole): Promise<string | null> {
  try {
    const branches = await fetchBranches();
    return reconcileBranchScope(role, branches);
  } catch {
    // Branch discovery must not turn a valid login into a failed login. The
    // guarded page can still surface its normal request error and retry.
    return readBranchId();
  }
}

export function reconcileBranchScope(
  role: StaffRole,
  branches: readonly Pick<BranchSummary, 'id'>[],
): string | null {
  const current = readBranchId();
  if (current && branches.some((branch) => branch.id === current)) return current;

  if (!isBusinessWideRole(role) && branches.length > 0) {
    // A limited role may never fall back to "All branches". When its prior
    // selection disappeared, choose another authorised assignment instead of
    // clearing storage to the widest possible scope.
    const assigned = branches[0]?.id ?? null;
    writeBranchId(assigned);
    return assigned;
  }

  // A removed/deactivated assignment must not survive in local storage.
  if (current) writeBranchId(null);
  return null;
}

/**
 * Bespoke pages whose data genuinely has no branch dimension.
 *
 * Checked as whole path segments, so `/admin/staff/<id>` is covered while
 * `/admin/auditors` is not mistaken for `/admin/audit`.
 *
 * ─── WHY login-history IS NOT HERE ───────────────────────────────────
 * It looks global — it is guarded by `staff` and its route reads no branch.
 * But the page renders `<ShiftsTable openOnly />` for its "on now" tab (F6.5),
 * and shifts ARE branch-scoped: "who is on at Marina right now" is precisely
 * the question an owner opens it to ask. Hiding the switcher there would
 * remove the filter from the one tab that needs it most.
 */
const UNSCOPED_PREFIXES = [
  '/admin/staff',
  '/admin/settings',
  '/admin/audit',
  '/admin/configuration',
] as const;

/** The generic resource pages, e.g. `/admin/r/products`. */
const RESOURCE_PREFIX = '/admin/r/';

/**
 * Does the branch switcher DO anything on this page?
 *
 * ─── A CONTROL THAT CHANGES NOTHING IS WORSE THAN NO CONTROL ─────────
 * Switching branch triggers a full document reload (see `branch-switcher.tsx`
 * on why). On a page whose data has no branch dimension — staff, settings, the
 * audit trail, the product catalogue — that reload returns the exact same rows
 * under a different branch name in the topbar. The reader is left to conclude
 * either that this branch happens to hold identical data, or that the filter
 * is broken. Both readings are wrong, and the control caused both.
 *
 * ─── WHAT COUNTS AS SCOPED IS DECIDED BY THE SERVER ──────────────────
 * For the generic `/admin/r/<resource>` pages the answer comes from the
 * schema's `branchScoped` flag, which the API derives from each resource's
 * `branchScopeField`. A hardcoded list of resource names here would drift the
 * moment one gains or loses scoping — and drift silently, because both states
 * render without error. Only the BESPOKE pages are named above, because those
 * have no schema entry.
 *
 * `pathname` is locale-stripped (it comes from `@/i18n/navigation`), so it
 * always starts at `/admin`. Anything unrecognised is treated as SCOPED:
 * showing the control is the safe default, because a page that does filter by
 * branch and offers no way to change it is a genuine loss of function,
 * whereas an inert control on one unrecognised page is only clutter.
 */
export function isBranchScopedPath(
  pathname: string,
  resources: readonly { resource: string; branchScoped?: boolean }[],
): boolean {
  if (
    UNSCOPED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return false;
  }

  if (pathname.startsWith(RESOURCE_PREFIX)) {
    // The segment right after the prefix; a deeper path (a row's detail view)
    // still belongs to the same resource.
    const name = pathname.slice(RESOURCE_PREFIX.length).split('/')[0];
    if (!name) return true;

    const schema = resources.find((resource) => resource.resource === name);
    // An unknown resource means the schema has not arrived yet (it is fetched
    // once, asynchronously). Showing the switcher while it loads is the less
    // jarring direction: it stays put rather than appearing a moment later.
    if (!schema) return true;

    return schema.branchScoped === true;
  }

  return true;
}
