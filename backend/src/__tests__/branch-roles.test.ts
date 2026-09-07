import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { resolveRoleAtBranch } from '../services/branch-roles.service.js';
import { canAccessArea } from '../config/roles.js';

/**
 * Per-branch roles — the test that has to exist BEFORE authorisation moves.
 *
 * ─── WHY THIS FILE IS WRITTEN FIRST ──────────────────────────────────
 * F8.3 scoped what a query RETURNS. This scopes what a person may DO, and the
 * failure mode is worse: a wrong answer here is not a number on a screen, it
 * is a manager at one branch reading another branch's staff list.
 *
 * Like the isolation leak, it fails silently — nothing throws, no typecheck
 * catches it, and the screen looks entirely normal to the person who should
 * not be seeing it. Writing the assertions afterwards would only prove that
 * whatever I wrote passes; writing them first states the contract.
 *
 * ─── THE CONTRACT ────────────────────────────────────────────────────
 * 1. No `UserBranch` row  -> the global `User.role`, unchanged. This migration
 *    must grant nothing and revoke nothing from anyone who existed before it.
 * 2. A row for THIS branch -> that row's role, instead of the global one.
 * 3. A row for ANOTHER branch -> does NOT apply here. This is the escalation
 *    case: a manager at Marina asking about Downtown gets Downtown's answer,
 *    not Marina's.
 * 4. The branch role REPLACES the global role, it is never unioned with it.
 *    A union would let a Marina-only manager reach Downtown by holding any
 *    global role at all.
 * 5. OWNER and DEVELOPER stay business-wide. An owner cannot be demoted at one
 *    branch, or they could lock themselves out of their own business.
 */

const RUN = `branchroles-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let businessId = '';
let marina = '';
let downtown = '';

const userIds: string[] = [];

async function makeUser(role: StaffRole, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${label}@example.test`,
      name: `${RUN} ${label}`,
      passwordHash: 'not-a-real-hash',
      role,
    },
  });
  userIds.push(user.id);
  return user.id;
}

beforeAll(async () => {
  const business = await prisma.business.create({ data: { name: `${RUN} business` } });
  businessId = business.id;

  const [a, b] = await Promise.all([
    prisma.branch.create({ data: { businessId, name: `${RUN} Marina`, code: `${RUN.slice(-6)}M` } }),
    prisma.branch.create({ data: { businessId, name: `${RUN} Downtown`, code: `${RUN.slice(-6)}D` } }),
  ]);
  marina = a.id;
  downtown = b.id;
});

afterAll(async () => {
  await prisma.userBranch.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
});

describe('a role is resolved from the branch being acted on', () => {
  it('falls back to the global role when the person has no branch row', async () => {
    // The migration must be a no-op for everyone who already existed. If this
    // fails, upgrading revoked access from real staff.
    const userId = await makeUser(StaffRole.MANAGER, 'no-rows');

    await expect(resolveRoleAtBranch(userId, marina)).resolves.toBe(StaffRole.MANAGER);
    await expect(resolveRoleAtBranch(userId, downtown)).resolves.toBe(StaffRole.MANAGER);
  });

  it('uses the branch role in place of the global one', async () => {
    const userId = await makeUser(StaffRole.SUPPORT, 'promoted-at-marina');
    await prisma.userBranch.create({
      data: { userId, branchId: marina, role: StaffRole.MANAGER },
    });

    await expect(resolveRoleAtBranch(userId, marina)).resolves.toBe(StaffRole.MANAGER);
  });

  it('does NOT apply one branch role at another branch', async () => {
    // The escalation case. A manager at Marina asking about Downtown must get
    // Downtown's answer — here, the global SUPPORT they hold everywhere else.
    const userId = await makeUser(StaffRole.SUPPORT, 'marina-only');
    await prisma.userBranch.create({
      data: { userId, branchId: marina, role: StaffRole.MANAGER },
    });

    await expect(resolveRoleAtBranch(userId, downtown)).resolves.toBe(StaffRole.SUPPORT);
  });

  it('lets the same person hold different roles at two branches', async () => {
    // The owner's actual question: a barista at one shop, a manager at another.
    const userId = await makeUser(StaffRole.DEMO, 'two-hats');
    await prisma.userBranch.createMany({
      data: [
        { userId, branchId: marina, role: StaffRole.FULFILLMENT },
        { userId, branchId: downtown, role: StaffRole.MANAGER },
      ],
    });

    await expect(resolveRoleAtBranch(userId, marina)).resolves.toBe(StaffRole.FULFILLMENT);
    await expect(resolveRoleAtBranch(userId, downtown)).resolves.toBe(StaffRole.MANAGER);
  });

  it('REPLACES the global role rather than adding to it', async () => {
    // A MANAGER globally, demoted to SUPPORT at Marina. If the two were
    // unioned, `settings` (manager-only) would still be reachable there — and
    // a demotion that grants nothing less is not a demotion.
    const userId = await makeUser(StaffRole.MANAGER, 'demoted-at-marina');
    await prisma.userBranch.create({
      data: { userId, branchId: marina, role: StaffRole.SUPPORT },
    });

    const atMarina = await resolveRoleAtBranch(userId, marina);

    expect(atMarina).toBe(StaffRole.SUPPORT);
    expect(canAccessArea(atMarina, 'settings')).toBe(false);
  });

  it('keeps OWNER business-wide, even with a lesser branch row', async () => {
    // An owner must not be demotable at one branch: a stray row would lock
    // them out of their own business, and nobody could put it back.
    const userId = await makeUser(StaffRole.OWNER, 'owner');
    await prisma.userBranch.create({
      data: { userId, branchId: marina, role: StaffRole.SUPPORT },
    });

    await expect(resolveRoleAtBranch(userId, marina)).resolves.toBe(StaffRole.OWNER);
  });

  it('keeps DEVELOPER business-wide too', async () => {
    const userId = await makeUser(StaffRole.DEVELOPER, 'developer');
    await prisma.userBranch.create({
      data: { userId, branchId: downtown, role: StaffRole.DEMO },
    });

    await expect(resolveRoleAtBranch(userId, downtown)).resolves.toBe(StaffRole.DEVELOPER);
  });

  it('falls back to the global role when no branch is named', async () => {
    // "All branches" is a real question — the unscoped reports still answer it
    // — so a request with no active branch must not be denied outright.
    const userId = await makeUser(StaffRole.SUPPORT, 'unscoped');
    await prisma.userBranch.create({
      data: { userId, branchId: marina, role: StaffRole.MANAGER },
    });

    await expect(resolveRoleAtBranch(userId, null)).resolves.toBe(StaffRole.SUPPORT);
  });

  it('never grants more than the global role to an inactive assignment', async () => {
    // A branch row on a deactivated branch must not keep working. Closing a
    // branch has to actually remove what it granted.
    const userId = await makeUser(StaffRole.SUPPORT, 'closed-branch');
    const closed = await prisma.branch.create({
      data: {
        businessId,
        name: `${RUN} Closed`,
        code: `${RUN.slice(-6)}C`,
        isActive: false,
      },
    });
    await prisma.userBranch.create({
      data: { userId, branchId: closed.id, role: StaffRole.MANAGER },
    });

    await expect(resolveRoleAtBranch(userId, closed.id)).resolves.toBe(StaffRole.SUPPORT);
  });
});
