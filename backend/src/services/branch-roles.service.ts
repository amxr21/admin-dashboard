import { StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';

/**
 * Which role a person actually holds while acting on a given branch (F8.4).
 *
 * ─── THE ONE RULE ────────────────────────────────────────────────────
 * The branch role REPLACES the global one. It is never added to it.
 *
 * A union would be the obvious implementation and is wrong in the direction
 * that matters: a person who is SUPPORT globally and MANAGER at Marina would
 * keep manager access everywhere, which is precisely the escalation this
 * exists to prevent. Replacement means a demotion at one branch is a real
 * demotion there, and a promotion at one branch stays there.
 *
 * ─── BUSINESS-WIDE ROLES ARE NOT BRANCH-SCOPED ───────────────────────
 * OWNER and DEVELOPER short-circuit before any lookup. An owner does not stop
 * being the owner by opening another branch, and if a stray `UserBranch` row
 * could demote them they would be one bad row away from being locked out of
 * their own business with nobody able to put it back.
 *
 * This is checked FIRST, so it holds even if such a row exists.
 *
 * ─── NO ROW MEANS NO CHANGE ──────────────────────────────────────────
 * Someone with no assignment keeps their global role exactly. That is what
 * makes the migration a no-op: every user who existed before this shipped is
 * as privileged as they were, and F8.4 grants nothing until an owner
 * deliberately assigns someone to a branch.
 */

/** Roles that apply across the whole business and are never branch-scoped. */
const BUSINESS_WIDE_ROLES: readonly StaffRole[] = [StaffRole.DEVELOPER, StaffRole.OWNER];

export function isBusinessWideRole(role: StaffRole): boolean {
  return BUSINESS_WIDE_ROLES.includes(role);
}

/**
 * @param branchId The branch being acted on, or `null` for an unscoped
 *   ("all branches") request — which resolves to the global role, because
 *   "how is the business doing" is a real question and refusing it outright
 *   is how a filter gets bypassed everywhere it is inconvenient.
 */
export async function resolveRoleAtBranch(
  userId: string,
  branchId: string | null,
): Promise<StaffRole> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  // A missing user is not this function's error to raise — `authenticate`
  // has already rejected that request. Returning the least privileged role
  // rather than throwing keeps the failure safe if it is ever reached.
  if (!user) return StaffRole.DEMO;

  if (isBusinessWideRole(user.role)) return user.role;
  if (!branchId) return user.role;

  const assignment = await prisma.userBranch.findUnique({
    where: { userId_branchId: { userId, branchId } },
    select: {
      role: true,
      // A closed branch must stop granting what it granted. Deactivating a
      // branch is the lightweight way to end its roster's access, and it
      // would be worth very little if the rows kept working.
      branch: { select: { isActive: true } },
    },
  });

  if (!assignment || !assignment.branch.isActive) return user.role;

  return assignment.role;
}

/**
 * Every branch a person has an explicit role at, with that role.
 *
 * Used by the staff screens and by the branch switcher to show where someone
 * works. Deliberately does NOT include branches they can reach through their
 * global role — those are "everywhere", not a roster entry, and listing them
 * would make a business-wide owner look like they had been assigned to every
 * branch individually.
 */
export async function listBranchRoles(userId: string) {
  return prisma.userBranch.findMany({
    where: { userId, branch: { isActive: true } },
    select: {
      branchId: true,
      role: true,
      branch: { select: { name: true, code: true, businessId: true } },
    },
    orderBy: { branch: { name: 'asc' } },
  });
}
