import { StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { canAssignRole, outranks } from '../config/roles.js';

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

/* ─────────────────────────────────────────────────────────────────────
 * WRITES (O7 stage 2) — putting people at branches
 *
 * F8.4 resolves a per-branch role correctly and there was NO WAY TO CREATE
 * ONE: this service only ever read. So the feature answering "different
 * people in different branches" could not actually be used, and every row in
 * the table had been put there by a migration or the seeder.
 *
 * This is what unlocks the shapes an owner actually described: a branch
 * manager with two or three cashiers under them, OR branches of cashiers with
 * the owner managing all of them directly — both, in the same install.
 *
 * ─── WHY THE STAFF RULES ARE IMPORTED, NOT REIMPLEMENTED ─────────────
 * `staff.service.ts` enforces four rules on every global role change: nobody
 * grants above their own rank, nobody changes their own role, nobody touches
 * someone who outranks them, the last owner survives.
 *
 * A per-branch grant that skipped them would not be a smaller version of the
 * same feature — it would be an escalation path AROUND the global rules. A
 * SUPPORT user who could assign themselves MANAGER at a branch has escalated,
 * whatever the global table says. So the same helpers are called here, rather
 * than a second copy of the logic that can drift from the first.
 * ───────────────────────────────────────────────────────────────────── */

export interface RosterActor {
  id: string;
  role: StaffRole;
}

/**
 * Rules 1-3, applied to a branch grant.
 *
 * Rule 4 (the last owner) does not apply: a branch role never removes
 * anyone's global role, so no branch write can remove the final OWNER. Rule 5
 * below is this stage's own addition.
 */
async function assertCanAssign(actor: RosterActor, userId: string, role: StaffRole) {
  // Rule 2 — nobody changes their own role, at any scope. Self-assignment at
  // a branch is the same act as self-promotion globally, just quieter.
  if (actor.id === userId) {
    throw AppError.forbidden('You cannot change your own role');
  }

  // Rule 1 — nobody grants above their own rank.
  if (!canAssignRole(actor.role, role)) {
    throw AppError.forbidden('You cannot grant a role with more access than your own', {
      field: 'role',
    });
  }

  // Rule 5 (this stage) — OWNER and DEVELOPER are business-wide and
  // `resolveRoleAtBranch` short-circuits on them before it ever reads this
  // table. Accepting such a row would write something that silently does
  // nothing, which is worse than refusing: the owner would see the grant on
  // screen and believe it took effect.
  if (isBusinessWideRole(role)) {
    throw AppError.badRequest(
      'OWNER and DEVELOPER apply across the whole business and cannot be granted per branch',
      { field: 'role' },
    );
  }

  // Rule 3 — nobody modifies someone who outranks them. Loaded here rather
  // than trusted from the request, because the subject's rank is the thing
  // being checked.
  const subject = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, email: true },
  });

  if (!subject) throw AppError.notFound('Staff member not found');

  if (outranks(subject.role, actor.role)) {
    throw AppError.forbidden('You cannot modify someone with more access than you');
  }

  return subject;
}

async function requireBranch(branchId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true },
  });

  if (!branch) throw AppError.notFound('Branch not found');

  return branch;
}

/**
 * Put someone at a branch, or change the role they hold there.
 *
 * An upsert on the `[userId, branchId]` pair, which is the unique constraint:
 * re-assigning somebody who is already there changes their role rather than
 * failing, because "make Sara a manager here instead" is the same intent as
 * "put Sara here as a manager" and an owner should not have to remove her
 * first.
 */
export async function assignUserToBranch(
  actor: RosterActor,
  branchId: string,
  userId: string,
  role: StaffRole,
) {
  const [branch, subject] = await Promise.all([
    requireBranch(branchId),
    assertCanAssign(actor, userId, role),
  ]);

  const existing = await prisma.userBranch.findUnique({
    where: { userId_branchId: { userId, branchId } },
    select: { role: true },
  });

  const assignment = await prisma.userBranch.upsert({
    where: { userId_branchId: { userId, branchId } },
    create: { userId, branchId, role },
    update: { role },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });

  return { assignment, branch, subject, previousRole: existing?.role ?? null };
}

/**
 * Take someone off a branch's roster.
 *
 * They keep their GLOBAL role — removing the row means "no longer placed
 * here", not "demoted". `resolveRoleAtBranch` falls back to `User.role` with
 * no row present, which is the same state as someone who was never assigned.
 */
export async function removeUserFromBranch(
  actor: RosterActor,
  branchId: string,
  userId: string,
) {
  const existing = await prisma.userBranch.findUnique({
    where: { userId_branchId: { userId, branchId } },
    select: { role: true },
  });

  if (!existing) throw AppError.notFound('That person is not assigned to this branch');

  // Rule 3 again, on the way out: removing someone from a branch is modifying
  // them, and reaching upward is no more acceptable here than on the way in.
  const subject = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });

  if (!subject) throw AppError.notFound('Staff member not found');

  if (actor.id === userId) {
    throw AppError.forbidden('You cannot change your own role');
  }

  if (outranks(subject.role, actor.role)) {
    throw AppError.forbidden('You cannot modify someone with more access than you');
  }

  await prisma.userBranch.delete({ where: { userId_branchId: { userId, branchId } } });

  return { removedRole: existing.role, subject };
}

/**
 * Who works at this branch, and in what capacity.
 *
 * Returns both roles on purpose. `role` is what they hold HERE and `globalRole`
 * is what they hold everywhere else — showing only the first would make a
 * SUPPORT-globally / MANAGER-here person look like a manager outright, which
 * is the exact confusion F8.4's replacement rule exists to avoid.
 */
export async function listBranchStaff(branchId: string) {
  await requireBranch(branchId);

  const rows = await prisma.userBranch.findMany({
    where: { branchId },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true, isActive: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    isActive: row.user.isActive,
    role: row.role,
    globalRole: row.user.role,
    assignedAt: row.createdAt.toISOString(),
  }));
}
