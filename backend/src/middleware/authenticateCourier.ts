import type { NextFunction, Request, Response } from 'express';
import { DeliveryStaffStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { verifyCourierToken } from '../services/courier-auth.service.js';

/**
 * Requires a valid courier Bearer token, and attaches the live courier to the
 * request. The courier equivalent of `authenticate.ts` — kept as a separate
 * file rather than a branch inside it, because the two guard different
 * entities (`DeliveryStaff` vs `User`) with no shared shape worth abstracting
 * over; see `courier-auth.service.ts` for why the tokens themselves can never
 * cross between the two surfaces.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /// Only present after `authenticateCourier` has run.
      courier?: { id: string; name: string };
    }
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

export async function authenticateCourier(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.header('authorization'));

    if (!token) {
      throw AppError.unauthorized('Authentication required');
    }

    const payload = verifyCourierToken(token);

    // Re-read every request, same reasoning as staff `authenticate`: the
    // token proves who signed in, not that the account is still usable — a
    // courier deactivated or stripped of their access code a minute ago
    // still holds a validly-signed token until it expires.
    const courier = await prisma.deliveryStaff.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, status: true },
    });

    if (!courier || courier.status === DeliveryStaffStatus.INACTIVE) {
      throw AppError.unauthorized('Invalid or expired session');
    }

    req.courier = { id: courier.id, name: courier.name };
    req.log = req.log.child({ courierId: courier.id });

    next();
  } catch (err) {
    next(err);
  }
}

/** Narrowing helper, same shape as `requireUser` in authenticate.ts. */
export function requireCourier(req: Request): { id: string; name: string } {
  if (!req.courier) {
    throw new Error(
      'requireCourier() called on a route without the authenticateCourier middleware. ' +
        'Mount authenticateCourier before this handler.',
    );
  }
  return req.courier;
}
