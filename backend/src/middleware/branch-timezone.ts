import type { NextFunction, Request, Response } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Effective timezone for date-only branch views. Business-wide views
       * deliberately use UTC rather than guessing one of several businesses. */
      branchTimezone?: string;
    }
  }
}

export async function resolveEffectiveTimezone(branchId: string | null | undefined): Promise<string> {
  if (!branchId) return 'UTC';

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true, business: { isActive: true } },
    select: { timezone: true, business: { select: { timezone: true } } },
  });

  // This normally cannot happen after withBranchContext. Keeping the helper
  // fail-closed makes it safe when reused by a background job or new route.
  if (!branch) throw AppError.notFound('Branch context is unavailable');
  return branch.timezone ?? branch.business.timezone ?? 'UTC';
}

export async function withBranchTimezone(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    req.branchTimezone = await resolveEffectiveTimezone(req.branchId);
    next();
  } catch (error) {
    next(error);
  }
}
