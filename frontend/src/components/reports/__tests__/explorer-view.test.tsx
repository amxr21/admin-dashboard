import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ExplorerView } from '../explorer-view';

/**
 * The generic report viewer (C3.3). What's worth pinning: the table and the
 * totals row/percent-of-total are derived from the SAME sorted rows the
 * chart reads (no second parallel computation that could disagree), the
 * default dimension is honoured on first load, switching the measure
 * re-sorts, and CSV export carries the current dimension through as a query
 * param rather than silently exporting whatever the default was.
 */

/**
 * A STATEFUL stand-in for the URL bar (dimension/measure live in the query
 * string via `useUrlState`). A `replace()` that didn't feed back into
 * `useSearchParams()` would break the loop this component depends on: it
 * writes the dimension, reads back the OLD one, and the Select never shows
 * the change — same shape as `reports-view.test.tsx`'s mock.
 */
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
  usePathname: () => '/admin/reports/explorer',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

const fetchExplorer = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchExplorer, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchExplorer.mockReset();
  downloadReport.mockReset();
});

function explorerData(dimension = 'category') {
  return {
    range: { from: '2026-01-01', to: '2026-01-31' },
    dimension,
    rows: [
      { key: 'c1', label: 'Home & Garden', revenue: '300.00', units: 30, orders: 10, averageOrderValue: '30.00' },
      { key: 'c2', label: 'Stationery', revenue: '100.00', units: 10, orders: 5, averageOrderValue: '20.00' },
    ],
  };
}

describe('loading and default state', () => {
  it('defaults to grouping by category', async () => {
    fetchExplorer.mockResolvedValue(explorerData());

    render(<ExplorerView />);

    await waitFor(() => {
      expect(fetchExplorer).toHaveBeenCalledWith(expect.any(Object), 'category');
    });
  });

  it('lists rows with revenue, units, orders, AOV and a computed % of total', async () => {
    fetchExplorer.mockResolvedValue(explorerData());

    render(<ExplorerView />);

    expect(await screen.findByText('Home & Garden')).toBeInTheDocument();
    expect(screen.getByText('Stationery')).toBeInTheDocument();
    // 300 / 400 = 75%
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders a totals row summing revenue, units and orders', async () => {
    fetchExplorer.mockResolvedValue(explorerData());

    render(<ExplorerView />);

    await screen.findByText('Home & Garden');
    // 30 + 10 units, 10 + 5 orders.
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('shows an empty state with no rows', async () => {
    fetchExplorer.mockResolvedValue({ range: { from: '2026-01-01', to: '2026-01-31' }, dimension: 'category', rows: [] });

    render(<ExplorerView />);

    expect(await screen.findByText(/no sales in this period/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchExplorer.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ExplorerView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('switching dimension and measure', () => {
  it('re-fetches with the new dimension', async () => {
    fetchExplorer.mockResolvedValue(explorerData());

    render(<ExplorerView />);
    await screen.findByText('Home & Garden');

    fetchExplorer.mockResolvedValue(explorerData('status'));
    await userEvent.click(screen.getByLabelText(/group by/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Order status' }));

    await waitFor(() => {
      expect(fetchExplorer).toHaveBeenLastCalledWith(expect.any(Object), 'status');
    });
  });

  it('re-sorts rows when the measure changes, without a re-fetch', async () => {
    fetchExplorer.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      dimension: 'category',
      rows: [
        // Higher revenue, fewer units.
        { key: 'c1', label: 'Home & Garden', revenue: '300.00', units: 5, orders: 2, averageOrderValue: '150.00' },
        // Lower revenue, more units.
        { key: 'c2', label: 'Stationery', revenue: '100.00', units: 50, orders: 20, averageOrderValue: '5.00' },
      ],
    });

    render(<ExplorerView />);
    await screen.findByText('Home & Garden');

    const callsBefore = fetchExplorer.mock.calls.length;
    await userEvent.click(screen.getByLabelText(/^measure$/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Units' }));

    // Stationery (50 units) should now sort first, above Home & Garden (5 units).
    const rows = await screen.findAllByRole('row');
    const bodyRowTexts = rows.slice(1, 3).map((r) => r.textContent);
    expect(bodyRowTexts[0]).toContain('Stationery');

    // Purely a client-side re-sort — same data, no extra fetch.
    expect(fetchExplorer.mock.calls.length).toBe(callsBefore);
  });
});

describe('export', () => {
  it('carries the current dimension through as a query param, in the chosen format', async () => {
    fetchExplorer.mockResolvedValue(explorerData());
    downloadReport.mockResolvedValue(undefined);

    render(<ExplorerView />);
    await screen.findByText('Home & Garden');

    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX)' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('explorer', expect.any(Object), 'xlsx', { dimension: 'category' });
    });
  });
});
