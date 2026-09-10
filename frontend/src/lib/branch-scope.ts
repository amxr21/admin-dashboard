import type { StaffRole } from '@/config/areas';
import { fetchBranches, type BranchSummary } from '@/lib/branches-api';
import { readBranchId, writeBranchId } from '@/lib/auth-storage';

const BUSINESS_WIDE_ROLES: readonly StaffRole[] = ['DEVELOPER', 'OWNER'];

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

  if (!BUSINESS_WIDE_ROLES.includes(role) && branches.length === 1) {
    const assigned = branches[0]?.id ?? null;
    writeBranchId(assigned);
    return assigned;
  }

  // A removed/deactivated assignment must not survive in local storage.
  if (current) writeBranchId(null);
  return null;
}
