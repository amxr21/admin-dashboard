import type { Request, Response, NextFunction } from 'express';

import { resolveRoleAtBranch } from '../services/branch-roles.service.js';
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
 * A header naming a branch the user has no assignment at resolves to their
 * GLOBAL role, which is the same answer as naming no branch at all. It does
 * not throw: the request is still authorised on its merits, and refusing it
 * outright would leak whether a given branch id exists to anyone who can
 * guess one.
 *
 * What it must never do is grant MORE than the global role, and that is the
 * resolver's rule, tested directly in `branch-roles.test.ts`.
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
    const branchId = header?.trim() ? header.trim() : null;

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
 * Falls back to the global role when `withBranchContext` has not run, so a
 * route that predates F8.4 behaves exactly as it did — the branch role is an
 * override where one exists, never a requirement.
 *
 * Deliberately a function rather than callers reading `req.branchRole ??
 * req.user.role` inline: that expression appearing in several places is how
 * one of them ends up reading `req.user.role` alone, which silently restores
 * the global role on a scoped request.
 */
export function effectiveRole(req: Request) {
  return req.branchRole ?? requireUser(req).role;
}
