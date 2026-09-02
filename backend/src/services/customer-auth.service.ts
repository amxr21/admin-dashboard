import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import type { Customer } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

/**
 * Storefront (customer) authentication — Google ID token in, customer JWT out.
 *
 * ─── WHY THIS IS SEPARATE FROM auth.service.ts ────────────────────────
 * That file authenticates STAFF: `User`, `StaffRole`, bcrypt, 2FA, lockout,
 * sessions, API keys, and the RBAC in `authorize.ts`. A shopper must never be
 * able to acquire any of it. Two things keep that true:
 *
 *   1. A different table. Customers live in `Customer`, which has no role
 *      column at all, so there is nothing for `requireArea` to grant.
 *   2. A `type: 'customer'` claim. `auth.service.ts#verifyToken` already
 *      REFUSES any token carrying a `type` claim — that check exists for
 *      pending-2FA tokens, and it protects us for free here: a customer token
 *      presented to a staff route fails as "Invalid or expired session"
 *      before the role is ever read. `customer-auth.test.ts` asserts this
 *      rather than trusting the design, exactly as the 2FA comment prescribes.
 *
 * The reverse direction is closed too: `verifyCustomerToken` below requires
 * `type === 'customer'`, so a STAFF token cannot be used to shop as, or read
 * the orders of, an arbitrary customer.
 *
 * Both token kinds are signed with `JWT_SECRET`. That is deliberate and
 * matches how pending-2FA tokens already work — the claim, not the key, is
 * what separates them, so there is one signing key to rotate rather than two
 * that can drift.
 */

/** Marks a token as belonging to the storefront, not the admin API. */
const CUSTOMER_TOKEN_TYPE = 'customer';

export interface CustomerTokenPayload {
  sub: string;
  type: typeof CUSTOMER_TOKEN_TYPE;
  /** Token version, for revocation — mirrors `User.tokenVersion` for staff. */
  tv: number;
}

/** A customer as the storefront is allowed to see itself. */
export type SafeCustomer = Pick<
  Customer,
  'id' | 'name' | 'email' | 'phone' | 'city' | 'country' | 'picture'
>;

/**
 * Strip staff-only fields before returning a customer to the storefront.
 *
 * `internalNotes` is the one that matters — it is explicitly staff-only (see
 * its schema comment) and returning the whole Prisma row would hand a shopper
 * whatever a staff member wrote about them.
 */
export function toSafeCustomer(customer: Customer): SafeCustomer {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    city: customer.city,
    country: customer.country,
    picture: customer.picture,
  };
}

export function signCustomerToken(customer: Pick<Customer, 'id' | 'tokenVersion'>): string {
  return jwt.sign(
    {
      sub: customer.id,
      type: CUSTOMER_TOKEN_TYPE,
      tv: customer.tokenVersion,
    } satisfies CustomerTokenPayload,
    env.JWT_SECRET,
    { expiresIn: env.CUSTOMER_JWT_EXPIRES_IN } as jwt.SignOptions,
  );
}

/**
 * Verify a storefront token.
 *
 * Every failure — expired, malformed, forged, or a STAFF token presented here —
 * returns the same message, for the same reason `verifyToken` does: telling a
 * caller which one it was is free reconnaissance.
 */
export function verifyCustomerToken(token: string): CustomerTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
      throw AppError.unauthorized('Invalid or expired session');
    }

    // The load-bearing check. A staff session token has no `type`, so it is
    // rejected here — a staff token must not be usable to read or mutate a
    // customer's cart and orders.
    if (decoded.type !== CUSTOMER_TOKEN_TYPE) {
      throw AppError.unauthorized('Invalid or expired session');
    }

    return {
      sub: decoded.sub,
      type: CUSTOMER_TOKEN_TYPE,
      // Narrowed to a number so a forged `tv: "0"` cannot compare loosely.
      tv: typeof decoded.tv === 'number' ? decoded.tv : 0,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized('Invalid or expired session');
  }
}

/**
 * Load the customer a verified token refers to.
 *
 * Re-read every request, like the staff path: the token proves who signed in,
 * not that the account still exists or that its tokens haven't been revoked.
 */
export async function getAuthenticatedCustomer(
  customerId: string,
  tokenVersion: number,
): Promise<Customer> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });

  if (!customer) throw AppError.unauthorized('Invalid or expired session');

  if (customer.tokenVersion !== tokenVersion) {
    throw AppError.unauthorized('Invalid or expired session');
  }

  return customer;
}

/**
 * Google's ID-token verifier.
 *
 * Only the public Client ID is needed to verify an ID token — there is no
 * client secret anywhere in this flow, so there is no additional credential to
 * leak. `audience` is what stops a token minted for a DIFFERENT application
 * being replayed at ours.
 */
let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID) {
    throw AppError.serviceUnavailable('Storefront sign-in is not configured');
  }
  googleClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return googleClient;
}

interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture: string;
}

/**
 * Verify a Google ID token and extract the profile.
 *
 * Raced against a timeout: Google is a third party on the critical path of
 * every sign-in, and without this a slow response holds the request (and a
 * connection) open indefinitely.
 */
async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const client = getGoogleClient();

  const ticket = await Promise.race([
    client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID }),
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(AppError.serviceUnavailable('Google sign-in timed out — please try again')),
        env.GOOGLE_VERIFY_TIMEOUT_MS,
      ),
    ),
  ]);

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email) {
    throw AppError.unauthorized('Google sign-in failed');
  }

  // An unverified email must not adopt an existing customer row by email
  // below — that would be an account-takeover path.
  if (payload.email_verified === false) {
    throw AppError.unauthorized('Your Google email address is not verified');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? '',
    picture: payload.picture ?? '',
  };
}

/**
 * Find or create the customer behind a Google profile.
 *
 * Three cases, in order:
 *   1. Known `googleId` → returning customer.
 *   2. Same email, no `googleId` → a row created by staff or by a guest
 *      checkout. ADOPT it, so a shopper's existing order history is still
 *      theirs after they first sign in. Safe only because the email is
 *      verified above.
 *   3. Neither → a new customer.
 */
async function upsertGoogleCustomer(profile: GoogleProfile): Promise<Customer> {
  const byGoogleId = await prisma.customer.findUnique({
    where: { googleId: profile.googleId },
  });

  if (byGoogleId) {
    return prisma.customer.update({
      where: { id: byGoogleId.id },
      data: { picture: profile.picture, lastLoginAt: new Date() },
    });
  }

  const byEmail = await prisma.customer.findUnique({ where: { email: profile.email } });

  if (byEmail) {
    return prisma.customer.update({
      where: { id: byEmail.id },
      data: {
        googleId: profile.googleId,
        picture: profile.picture,
        lastLoginAt: new Date(),
        // Don't overwrite a name staff may have corrected; fill it only if empty.
        ...(byEmail.name ? {} : { name: profile.name }),
      },
    });
  }

  return prisma.customer.create({
    data: {
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name || profile.email,
      picture: profile.picture,
      lastLoginAt: new Date(),
    },
  });
}

export interface CustomerLoginResult {
  token: string;
  customer: SafeCustomer;
}

/** The storefront login flow: Google ID token → app token + customer. */
export async function loginWithGoogle(idToken: string): Promise<CustomerLoginResult> {
  const profile = await verifyGoogleIdToken(idToken);
  const customer = await upsertGoogleCustomer(profile);

  return {
    token: signCustomerToken(customer),
    customer: toSafeCustomer(customer),
  };
}
