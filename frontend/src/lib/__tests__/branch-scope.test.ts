import { afterEach, describe, expect, it } from 'vitest';

import { readBranchId, writeBranchId } from '@/lib/auth-storage';
import { isBranchScopedPath, reconcileBranchScope } from '@/lib/branch-scope';

afterEach(() => window.localStorage.clear());

describe('reconcileBranchScope', () => {
  it('automatically selects the only branch assigned to a cashier', () => {
    expect(reconcileBranchScope('CASHIER', [{ id: 'marina' }])).toBe('marina');
    expect(readBranchId()).toBe('marina');
  });

  it('preserves All branches for business-wide roles', () => {
    expect(reconcileBranchScope('OWNER', [{ id: 'marina' }])).toBeNull();
    expect(readBranchId()).toBeNull();
  });

  it('preserves a valid explicit selection when several branches are assigned', () => {
    writeBranchId('downtown');
    expect(
      reconcileBranchScope('CASHIER', [{ id: 'marina' }, { id: 'downtown' }]),
    ).toBe('downtown');
  });

  it('clears a branch that is no longer assigned', () => {
    writeBranchId('closed');
    expect(reconcileBranchScope('CASHIER', [{ id: 'marina' }, { id: 'downtown' }])).toBeNull();
    expect(readBranchId()).toBeNull();
  });
});

/**
 * Where the branch switcher is worth showing.
 *
 * The property worth pinning is the ASYMMETRY of the two failure modes. Hiding
 * the control on a page that does scope is a real loss of function; showing it
 * on a page that does not is clutter. So everything unrecognised — an unknown
 * route, a resource whose schema has not loaded yet — must fall through to
 * SHOWN, and these tests exist to stop a later "tidy up the default" from
 * quietly inverting that.
 */
const RESOURCES = [
  { resource: 'products', branchScoped: false },
  { resource: 'notifications', branchScoped: true },
  // Deliberately absent `branchScoped`, as an older API build would send.
  { resource: 'customers' },
];

describe('isBranchScopedPath — bespoke pages with no branch dimension', () => {
  it.each(['/admin/staff', '/admin/settings', '/admin/audit', '/admin/configuration'])(
    'hides the switcher on %s',
    (pathname) => {
      expect(isBranchScopedPath(pathname, RESOURCES)).toBe(false);
    },
  );

  it('hides it on a nested path under an unscoped page', () => {
    expect(isBranchScopedPath('/admin/staff/abc123', RESOURCES)).toBe(false);
  });

  it('does NOT hide it on a path that merely shares a prefix string', () => {
    // Guards against a bare `startsWith` — "/admin/auditors" is not "/admin/audit".
    expect(isBranchScopedPath('/admin/auditors', RESOURCES)).toBe(true);
  });
});

describe('isBranchScopedPath — pages that genuinely scope', () => {
  it.each([
    '/admin',
    '/admin/orders',
    '/admin/returns',
    '/admin/delivery',
    '/admin/inventory',
    '/admin/pos',
    '/admin/shifts',
    '/admin/reports',
    // F6.5 — renders <ShiftsTable openOnly />, and shifts ARE branch-scoped.
    // The route reads no branch itself, which is exactly why this is easy to
    // get wrong.
    '/admin/login-history',
  ])('keeps the switcher on %s', (pathname) => {
    expect(isBranchScopedPath(pathname, RESOURCES)).toBe(true);
  });
});

describe('isBranchScopedPath — /r/ resources follow the schema, not a list', () => {
  it('hides it for a resource the server says is unscoped', () => {
    expect(isBranchScopedPath('/admin/r/products', RESOURCES)).toBe(false);
  });

  it('keeps it for a resource the server says is scoped', () => {
    expect(isBranchScopedPath('/admin/r/notifications', RESOURCES)).toBe(true);
  });

  it('treats a missing `branchScoped` as unscoped', () => {
    expect(isBranchScopedPath('/admin/r/customers', RESOURCES)).toBe(false);
  });

  it('keeps it while the schema is still loading', () => {
    expect(isBranchScopedPath('/admin/r/products', [])).toBe(true);
  });

  it('applies the resource rule to a row detail path too', () => {
    expect(isBranchScopedPath('/admin/r/products/row-1', RESOURCES)).toBe(false);
  });
});
