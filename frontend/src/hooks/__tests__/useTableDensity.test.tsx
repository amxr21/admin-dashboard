import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useTableDensity } from '../useTableDensity';

/**
 * Per-table density override, layered on top of the store-wide `ui.density`
 * setting. The contract worth pinning: `null` genuinely means "inherit the
 * global setting" (not "comfortable"), the choice is scoped to ONE table id
 * so a decision on Orders can't silently affect Inventory, and it survives
 * a reload via localStorage the same way `useSidebarCollapse` does.
 */

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('default state', () => {
  it('starts as null — inherit the global setting, not "comfortable"', async () => {
    const { result } = renderHook(() => useTableDensity('orders'));

    await waitFor(() => expect(result.current.override).toBeNull());
  });

  it('reads a previously stored choice for this table', async () => {
    window.localStorage.setItem('admin-dashboard:table-density:orders', 'compact');

    const { result } = renderHook(() => useTableDensity('orders'));

    await waitFor(() => expect(result.current.override).toBe('compact'));
  });

  it('ignores a corrupted stored value rather than crashing', async () => {
    window.localStorage.setItem('admin-dashboard:table-density:orders', 'nonsense');

    const { result } = renderHook(() => useTableDensity('orders'));

    await waitFor(() => expect(result.current.override).toBeNull());
  });
});

describe('setting an override', () => {
  it('persists the choice and reflects it immediately', async () => {
    const { result } = renderHook(() => useTableDensity('orders'));
    await waitFor(() => expect(result.current.override).toBeNull());

    act(() => result.current.setOverride('compact'));

    expect(result.current.override).toBe('compact');
    expect(window.localStorage.getItem('admin-dashboard:table-density:orders')).toBe('compact');
  });

  it('clears back to inherit when set to null', async () => {
    const { result } = renderHook(() => useTableDensity('orders'));
    await waitFor(() => expect(result.current.override).toBeNull());

    act(() => result.current.setOverride('compact'));
    act(() => result.current.setOverride(null));

    expect(result.current.override).toBeNull();
    expect(window.localStorage.getItem('admin-dashboard:table-density:orders')).toBeNull();
  });
});

describe('scoping', () => {
  it('keeps two tables independent — a choice on one never leaks to the other', async () => {
    const orders = renderHook(() => useTableDensity('orders'));
    await waitFor(() => expect(orders.result.current.override).toBeNull());
    act(() => orders.result.current.setOverride('compact'));

    const inventory = renderHook(() => useTableDensity('inventory'));
    await waitFor(() => expect(inventory.result.current.override).toBeNull());

    expect(orders.result.current.override).toBe('compact');
    expect(inventory.result.current.override).toBeNull();
  });
});
