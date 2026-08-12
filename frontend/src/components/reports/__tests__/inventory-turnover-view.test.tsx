import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { InventoryTurnoverView } from '../inventory-turnover-view';

/** Stateful, and re-renders subscribers on write — this view's tab switch
 *  writes to the URL and depends on reading the new value back immediately,
 *  unlike the other three report views' plain date-range writes. */
const urlState = vi.hoisted(() => {
  let current = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    reset: () => {
      current = new URLSearchParams();
    },
    write: (href: string) => {
      current = new URLSearchParams(href.split('?')[1] ?? '');
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({ push: (href: string) => urlState.write(href), replace: (href: string) => urlState.write(href) }),
  usePathname: () => '/admin/reports/inventory-turnover',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

const fetchInventoryTurnover = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchInventoryTurnover, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchInventoryTurnover.mockReset();
  downloadReport.mockReset();
});

function makeData() {
  return {
    range: { from: '2026-01-01', to: '2026-01-31' },
    turnover: [
      { productId: 'p1', name: 'Fast Mover', sku: 'SKU-1', stock: 10, unitsSold: 40 },
      { productId: 'p2', name: 'Stale Widget', sku: 'SKU-2', stock: 20, unitsSold: 0 },
    ],
    deadStock: [{ productId: 'p2', name: 'Stale Widget', sku: 'SKU-2', stock: 20, unitsSold: 0 }],
  };
}

describe('inventory turnover view (C3.5)', () => {
  it('shows the turnover tab by default, with every product', async () => {
    fetchInventoryTurnover.mockResolvedValue(makeData());

    render(<InventoryTurnoverView />);

    expect(await screen.findByText('Fast Mover')).toBeInTheDocument();
    expect(screen.getByText('Stale Widget')).toBeInTheDocument();
  });

  it('switches to the dead-stock tab and shows only zero-sale products with stock', async () => {
    fetchInventoryTurnover.mockResolvedValue(makeData());

    render(<InventoryTurnoverView />);

    await screen.findByText('Fast Mover');
    await userEvent.click(screen.getByRole('tab', { name: /dead stock/i }));

    expect(screen.queryByText('Fast Mover')).not.toBeInTheDocument();
    expect(screen.getByText('Stale Widget')).toBeInTheDocument();
  });

  it('shows a "nothing idle" message when dead stock is empty', async () => {
    fetchInventoryTurnover.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      turnover: [{ productId: 'p1', name: 'Fast Mover', sku: 'SKU-1', stock: 10, unitsSold: 40 }],
      deadStock: [],
    });

    render(<InventoryTurnoverView />);

    await screen.findByText('Fast Mover');
    await userEvent.click(screen.getByRole('tab', { name: /dead stock/i }));

    expect(await screen.findByText(/nothing is sitting idle/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchInventoryTurnover.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<InventoryTurnoverView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('exports in the chosen format', async () => {
    fetchInventoryTurnover.mockResolvedValue(makeData());
    downloadReport.mockResolvedValue(undefined);

    render(<InventoryTurnoverView />);

    await userEvent.click(await screen.findByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX)' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('inventory-turnover', expect.any(Object), 'xlsx', undefined);
    });
  });
});
