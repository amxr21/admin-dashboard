import { afterEach, describe, expect, it } from 'vitest';

import { readBranchId, writeBranchId } from '@/lib/auth-storage';
import { reconcileBranchScope } from '@/lib/branch-scope';

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
