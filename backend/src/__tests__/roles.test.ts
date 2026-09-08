import { describe, expect, it } from 'vitest';
import { StaffRole } from '@prisma/client';

import { canAccessArea, outranks } from '../config/roles.js';

/**
 * The role → area map, and rank.
 *
 * Pure config, so these are cheap — and the map is the single place a wrong
 * edit silently widens what somebody can reach, with nothing on screen to
 * show it.
 */
describe('the CASHIER role (O5.10)', () => {
  /**
   * Added LAST on purpose: the TODO warned that granting it first would hand
   * somebody screens that cannot take money. Those screens exist now.
   *
   * The grant is deliberately NARROWER than FULFILLMENT. A cashier reads stock
   * through the scan (which reports it) and the product list, but editing
   * stock is a different job — requiring it to sell a coffee is exactly the
   * over-granting O4 exists to correct.
   */
  it('can reach the till and returns, but not inventory', () => {
    expect(canAccessArea(StaffRole.CASHIER, 'orders')).toBe(true);
    expect(canAccessArea(StaffRole.CASHIER, 'returns')).toBe(true);
    expect(canAccessArea(StaffRole.CASHIER, 'products')).toBe(true);

    // The line that matters.
    expect(canAccessArea(StaffRole.CASHIER, 'inventory')).toBe(false);
    expect(canAccessArea(StaffRole.CASHIER, 'delivery')).toBe(false);
    expect(canAccessArea(StaffRole.CASHIER, 'reports')).toBe(false);
    expect(canAccessArea(StaffRole.CASHIER, 'settings')).toBe(false);
    expect(canAccessArea(StaffRole.CASHIER, 'staff')).toBe(false);
  });

  it('outranks nobody, and a manager outranks it', () => {
    // Rank decides only "who may change whose role". A cashier managing
    // nobody is the point.
    expect(outranks(StaffRole.MANAGER, StaffRole.CASHIER)).toBe(true);
    expect(outranks(StaffRole.CASHIER, StaffRole.MANAGER)).toBe(false);
    expect(outranks(StaffRole.CASHIER, StaffRole.SUPPORT)).toBe(false);
  });

  it('is narrower than FULFILLMENT, not a rename of it', () => {
    // If these ever match, one of the two roles has stopped earning its
    // place in the permission matrix.
    expect(canAccessArea(StaffRole.FULFILLMENT, 'inventory')).toBe(true);
    expect(canAccessArea(StaffRole.CASHIER, 'inventory')).toBe(false);
  });
});
