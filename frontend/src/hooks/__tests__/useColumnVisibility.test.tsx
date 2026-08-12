import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useColumnVisibility } from '../useColumnVisibility';

/**
 * Per-table column show/hide. The contract worth pinning: this is a
 * DENYLIST, not an allowlist — a column is visible unless explicitly hidden
 * — so a table gaining a new column later shows it by default rather than
 * silently hiding it because an old stored preference never mentioned it.
 */

beforeEach(() => {
  window.localStorage.clear();
});

describe('default state', () => {
  it('starts with nothing hidden', async () => {
    const { result } = renderHook(() => useColumnVisibility('orders'));
    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));
  });

  it('reads a previously stored hidden set for this table', async () => {
    window.localStorage.setItem(
      'admin-dashboard:hidden-columns:orders',
      JSON.stringify(['sku', 'createdAt']),
    );

    const { result } = renderHook(() => useColumnVisibility('orders'));

    await waitFor(() => expect(result.current.hiddenColumns.has('sku')).toBe(true));
    expect(result.current.hiddenColumns.has('createdAt')).toBe(true);
    expect(result.current.hiddenColumns.has('name')).toBe(false);
  });

  it('ignores corrupted JSON rather than crashing', async () => {
    window.localStorage.setItem('admin-dashboard:hidden-columns:orders', '{not valid json');

    const { result } = renderHook(() => useColumnVisibility('orders'));

    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));
  });

  it('ignores a stored value that is not an array', async () => {
    window.localStorage.setItem(
      'admin-dashboard:hidden-columns:orders',
      JSON.stringify({ sku: true }),
    );

    const { result } = renderHook(() => useColumnVisibility('orders'));

    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));
  });
});

describe('toggling', () => {
  it('hides a column when toggled off', async () => {
    const { result } = renderHook(() => useColumnVisibility('orders'));
    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));

    act(() => result.current.toggle('sku', false));

    expect(result.current.hiddenColumns.has('sku')).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem('admin-dashboard:hidden-columns:orders') ?? '[]'),
    ).toEqual(['sku']);
  });

  it('shows a column again when toggled on', async () => {
    const { result } = renderHook(() => useColumnVisibility('orders'));
    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));

    act(() => result.current.toggle('sku', false));
    act(() => result.current.toggle('sku', true));

    expect(result.current.hiddenColumns.has('sku')).toBe(false);
    // Back to nothing hidden clears the key entirely rather than storing "[]".
    expect(window.localStorage.getItem('admin-dashboard:hidden-columns:orders')).toBeNull();
  });

  it('tracks multiple hidden columns independently', async () => {
    const { result } = renderHook(() => useColumnVisibility('orders'));
    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));

    act(() => result.current.toggle('sku', false));
    act(() => result.current.toggle('createdAt', false));

    expect(result.current.hiddenColumns.has('sku')).toBe(true);
    expect(result.current.hiddenColumns.has('createdAt')).toBe(true);
    expect(result.current.hiddenColumns.size).toBe(2);
  });
});

describe('reset', () => {
  it('clears every hidden column and the stored key', async () => {
    const { result } = renderHook(() => useColumnVisibility('orders'));
    await waitFor(() => expect(result.current.hiddenColumns.size).toBe(0));

    act(() => result.current.toggle('sku', false));
    act(() => result.current.toggle('createdAt', false));
    act(() => result.current.reset());

    expect(result.current.hiddenColumns.size).toBe(0);
    expect(window.localStorage.getItem('admin-dashboard:hidden-columns:orders')).toBeNull();
  });
});

describe('scoping', () => {
  it('keeps two tables independent', async () => {
    const orders = renderHook(() => useColumnVisibility('orders'));
    await waitFor(() => expect(orders.result.current.hiddenColumns.size).toBe(0));
    act(() => orders.result.current.toggle('sku', false));

    const inventory = renderHook(() => useColumnVisibility('inventory'));
    await waitFor(() => expect(inventory.result.current.hiddenColumns.size).toBe(0));

    expect(orders.result.current.hiddenColumns.has('sku')).toBe(true);
    expect(inventory.result.current.hiddenColumns.has('sku')).toBe(false);
  });
});
