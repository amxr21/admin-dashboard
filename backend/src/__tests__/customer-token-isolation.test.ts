import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { StaffRole } from '@prisma/client';

import { env } from '../config/env.js';
import { signToken, verifyToken } from '../services/auth.service.js';
import { signCustomerToken, verifyCustomerToken } from '../services/customer-auth.service.js';

/**
 * The security boundary between STAFF tokens and STOREFRONT tokens.
 *
 * Both are signed with the same `JWT_SECRET` — deliberately, matching how
 * pending-2FA tokens already work — so the ONLY thing separating them is the
 * `type: 'customer'` claim. That makes these assertions the load-bearing proof
 * that the separation is real, exactly as `auth.service.ts` says about the 2FA
 * check it mirrors: "Caught by two-factor.test.ts, not assumed safe from the
 * design alone."
 *
 * If any test in this file starts failing, a customer can act as staff or vice
 * versa. Do not skip or weaken one to get a build green.
 *
 * No database required: these exercise the pure sign/verify functions, so they
 * run in CI even without the MySQL service container.
 */

const staffUser = {
  id: 'staff-user-id',
  role: StaffRole.OWNER,
  tokenVersion: 0,
};

const customer = {
  id: 'customer-id',
  tokenVersion: 0,
};

describe('customer/staff token isolation', () => {
  describe('a customer token cannot be used as a staff token', () => {
    it('is rejected by the staff verifier', () => {
      const customerToken = signCustomerToken(customer);

      // THE critical assertion. Without the `type` guard in verifyToken, this
      // token would decode, `role` would be undefined-cast-to-StaffRole, and
      // getAuthenticatedUser would load a real user — handing a shopper a
      // staff session.
      expect(() => verifyToken(customerToken)).toThrow();
    });

    it('is rejected even when it carries a forged staff role', () => {
      // An attacker who knows the shape would try adding `role` themselves.
      // They cannot sign it without JWT_SECRET, but this proves the claim
      // check — not merely the signature — is what refuses it.
      const forged = jwt.sign(
        { sub: customer.id, type: 'customer', tv: 0, role: StaffRole.OWNER },
        env.JWT_SECRET,
        { expiresIn: '30d' },
      );

      expect(() => verifyToken(forged)).toThrow();
    });
  });

  describe('a staff token cannot be used as a customer token', () => {
    it('is rejected by the customer verifier', () => {
      const staffToken = signToken(staffUser);

      // The reverse direction matters too: a staff token must not let anyone
      // read or mutate an arbitrary shopper's cart and order history.
      expect(() => verifyCustomerToken(staffToken)).toThrow();
    });
  });

  describe('each verifier accepts its own token', () => {
    it('the staff verifier accepts a staff token', () => {
      const payload = verifyToken(signToken(staffUser));

      expect(payload.sub).toBe(staffUser.id);
      expect(payload.role).toBe(StaffRole.OWNER);
    });

    it('the customer verifier accepts a customer token', () => {
      const payload = verifyCustomerToken(signCustomerToken(customer));

      expect(payload.sub).toBe(customer.id);
      expect(payload.type).toBe('customer');
    });
  });

  describe('customer tokens carry no privilege claims', () => {
    it('has no role in the payload', () => {
      const decoded = jwt.decode(signCustomerToken(customer));

      // A customer token must never carry a role, even an inert one — a future
      // reader must not be able to find one and be tempted to trust it.
      expect(decoded).not.toHaveProperty('role');
    });
  });

  describe('revocation', () => {
    it('rejects a token whose version is behind the customer record', () => {
      // getAuthenticatedCustomer compares the token's `tv` to the row's. This
      // asserts the claim is actually carried, since a field that is signed but
      // dropped during verification makes revocation silently do nothing —
      // which is precisely the bug auth.service.ts documents having had.
      const payload = verifyCustomerToken(signCustomerToken({ id: 'c1', tokenVersion: 7 }));

      expect(payload.tv).toBe(7);
    });
  });
});
