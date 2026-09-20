import type { Request, Response, NextFunction } from 'express';

import { prisma } from '../db/prisma.js';
import {
  isBusinessWideRole,
  resolveRoleAtBranch,
} from '../services/branch-roles.service.js';
import { requireUser } from './authenticate.js';

/**
 * Establishes which branch a request is acting on, and what the caller may do
 * there (F8.4). Always mounted AFTER `authenticate` and BEFORE `requireArea`.
 *
 * ─── WHY A HEADER AND NOT A QUERY PARAMETER ──────────────────────────
 * The active branch is a property of the SESSION's current context, not of
 * any one endpoint's arguments. As a query parameter it would have to be
 * threaded through every call site in the frontend, and the one that got
 * forgotten would silently fall back to "all branches" — which is the widest
 * possible answer, exactly the wrong direction for a missed filter to fail.
 *
 * A header is set once by the API client and travels with everything.
 *
 * ─── AN UNKNOWN BRANCH IS NOT AN ERROR HERE ──────────────────────────
 * OWNER and DEVELOPER may deliberately work without a selected branch. Every
 * other role needs an active assignment to the requested branch. Missing,
 * unknown, inactive and unassigned branch ids all produce the same generic
 * 404 so the refusal does not reveal whether a guessed id exists.
 */

/** The header the frontend sets once it has an active branch. */
export const BRANCH_HEADER = 'x-branch-id';

export async function withBranchContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireUser(req);

    const header = req.header(BRANCH_HEADER);
    // An empty or whitespace-only header is "no branch", not a branch whose id
    // is the empty string — a lookup on `''` would be a guaranteed miss that
    // reads like a real one.
    let branchId = header?.trim() ? header.trim() : null;

    // A staff member assigned to exactly one active branch has no ambiguous
    // choice to make. Resolve that branch server-side so clock-in and other
    // authenticated clients remain usable before the switcher has hydrated,
    // while zero or multiple assignments still fail closed below.
    if (!branchId && !isBusinessWideRole(user.role)) {
      const assignments = await prisma.userBranch.findMany({
        where: {
          userId: user.id,
          branch: { isActive: true, business: { isActive: true } },
        },
        select: { branchId: true },
        take: 2,
      });
      if (assignments.length === 1) branchId = assignments[0]!.branchId;
    }

    req.branchId = branchId;
    req.branchRole = await resolveRoleAtBranch(user.id, branchId);

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * The role authorisation should read for this request.
 *
 * Falls back to the global role only when `withBranchContext` has not run.
 * Branch-owned routes must mount the middleware; once mounted, limited roles
 * cannot reach the handler without a valid assignment.
 *
 * Deliberately a function rather than callers reading `req.branchRole ??
 * req.user.role` inline: that expression appearing in several places is how
 * one of them ends up reading `req.user.role` alone, which silently restores
 * the global role on a scoped request.
 */
export function effectiveRole(req: Request) {
  return req.branchRole ?? requireUser(req).role;
}
