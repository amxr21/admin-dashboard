import type { Request, Response, NextFunction } from 'express';
import type { Customer } from '@prisma/client';

import { AppError } from '../errors/AppError.js';
import {
  getAuthenticatedCustomer,
  verifyCustomerToken,
} from '../services/customer-auth.service.js';

/**
 * Storefront authentication. The customer-side counterpart to
 * `authenticate.ts`, and deliberately a SEPARATE middleware rather than a flag
 * on that one.
 *
 * What it does NOT do is the point: no `assertCanWrite`, no maintenance check,
 * no IP allowlist, no 2FA compliance, and — critically — it sets `req.customer`
 * and never `req.user`. Everything downstream of the admin `authenticate`
 * (`requireArea`, `assertCanWrite`, the audit trail) keys off `req.user`, so a
 * shopper can never satisfy an admin guard by construction: there is no code
 * path from here that populates the field those guards read.
 *
 * The token itself is separated by a `type: 'customer'` claim — see
 * `customer-auth.service.ts` for why that check is load-bearing in both
 * directions.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /// Only present after `authenticateCustomer` (or `optionalCustomer`).
      /// Deliberately distinct from `req.user`, which is STAFF.
      customer?: Customer;
    }
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  // Case-insensitive per RFC 7235 — clients legitimately send "bearer".
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/** Resolve the customer behind the request's token, or throw. */
async function resolveCustomer(token: string): Promise<Customer> {
  const payload = verifyCustomerToken(token);
  // Re-read every request: the token proves who signed in, not that the
  // account still exists or that its tokens haven't been revoked since.
  return getAuthenticatedCustomer(payload.sub, payload.tv);
}

/** Requires a valid storefront token. Use on cart, wishlist and order history. */
export async function authenticateCustomer(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.header('authorization'));
    if (!token) throw AppError.unauthorized('Please sign in to continue');

    const customer = await resolveCustomer(token);
    req.customer = customer;
    req.log = req.log.child({ customerId: customer.id });

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches the customer when a valid token is present, but never rejects.
 *
 * For routes that legitimately serve both guests and signed-in shoppers —
 * checkout being the important one, since guest checkout must keep working.
 *
 * An INVALID token is treated as a guest rather than an error: a shopper whose
 * token expired mid-session should still be able to complete a purchase, not
 * hit a wall at the last step.
 */
export async function optionalCustomer(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) return next();

  try {
    const customer = await resolveCustomer(token);
    req.customer = customer;
    req.log = req.log.child({ customerId: customer.id });
  } catch {
    // Deliberately ignored — proceed as a guest.
  }

  next();
}

/**
 * Narrowing helper for handlers behind `authenticateCustomer`.
 *
 * Mirrors `requireUser`: throws a clear internal error rather than `!`-asserting,
 * so removing the middleware fails loudly instead of silently reading undefined.
 */
export function requireCustomer(req: Request): Customer {
  if (!req.customer) {
    throw new Error(
      'requireCustomer() called on a route without the authenticateCustomer middleware. ' +
        'Mount authenticateCustomer before this handler.',
    );
  }
  return req.customer;
}
