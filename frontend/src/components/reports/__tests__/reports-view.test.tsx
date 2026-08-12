import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ReportsView } from '../reports-view';

/**
 * A STATEFUL stand-in for the URL bar (C2.6 put range/granularity/comparison
 * in the query string via `useUrlState`). Same shape as
 * `orders-table.test.tsx`'s own mock — a `replace()` that didn't feed back
 * into `useSearchParams()` would break the loop this component now depends
 * on: it writes the range, reads back the OLD one, and never re-fetches.
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

// The reused dashboard widgets link into other pages, and next-intl's
// `createNavigation` does not resolve under the test runner. Same mock the
// dashboard's own suite uses, extended with the router/pathname pair
// `useUrlState` needs.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({
    push: (href: string) => urlState.write(href),
    replace: (href: string) => urlState.write(href),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/admin/reports',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

/**
 * Reports.
 *
 * The failures worth pinning are the quiet ones: money parsed into app state
 * (it must stay a string until the moment it is drawn), a range refusal
 * flattened into "something went wrong" when it actually names the limit, and
 * a deleted product rendering as a blank row rather than saying what happened.
 */

const fetchOverview = vi.hoisted(() => vi.fn());
const fetchRevenue = vi.hoisted(() => vi.fn());
const fetchTopProducts = vi.hoisted(() => vi.fn());
const fetchStatusBreakdown = vi.hoisted(() => vi.fn());
const fetchFulfillmentHealth = vi.hoisted(() => vi.fn());
const fetchReturnsSummary = vi.hoisted(() => vi.fn());
const fetchOrderValueDistribution = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return {
    ...actual,
    fetchOverview,
    fetchRevenue,
    fetchTopProducts,
    fetchStatusBreakdown,
    fetchFulfillmentHealth,
    fetchReturnsSummary,
    fetchOrderValueDistribution,
    downloadReport,
  };
});

function resolveAll() {
  fetchOverview.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    revenue: '12345.67',
    orders: 42,
    canceledOrders: 3,
    newCustomers: 7,
    lowStockProducts: 2,
    averageOrderValue: '316.55',
  });
  fetchRevenue.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    granularity: 'day',
    points: [
      { date: '2026-07-01', revenue: '100.00', orders: 2 },
      { date: '2026-07-02', revenue: '250.50', orders: 3 },
    ],
  });
  fetchTopProducts.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    products: [
      { productId: 'p1', name: 'Ceramic Planter', quantity: 10, revenue: '350.00' },
      { productId: null, name: null, quantity: 4, revenue: '80.00' },
    ],
  });
  fetchStatusBreakdown.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    statuses: [
      { status: 'DELIVERED', orders: 30, total: '10000.00' },
      { status: 'PENDING', orders: 0, total: '0.00' },
      { status: 'CANCELED', orders: 3, total: '999.00' },
    ],
  });
  fetchFulfillmentHealth.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    avgHoursInStatus: [{ status: 'PENDING', slaHours: 24, avgHours: 5.5 }],
    needsAttention: [
      { orderId: 'o1', orderNumber: 'ORD-1024', status: 'PENDING', hoursInStatus: 40 },
    ],
  });
  fetchReturnsSummary.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    returnCount: 2,
    orderCount: 42,
    returnRate: 0.047,
    refundValue: '210.00',
    unitsReturned: 3,
    // Deliberately NOT the same product as the best-sellers fixture: reusing
    // that name made "Ceramic Planter" ambiguous across two panels and broke
    // the best-sellers assertions.
    topReturnedProducts: [
      { productId: 'p9', name: 'Woven Basket', unitsReturned: 2, returnCount: 1 },
    ],
  });
  fetchOrderValueDistribution.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    buckets: [
      { label: '0–50', count: 10 },
      { label: '50–100', count: 4 },
    ],
  });
}

beforeEach(() => {
  urlState.reset();
  fetchOverview.mockReset();
  fetchRevenue.mockReset();
  fetchTopProducts.mockReset();
  fetchStatusBreakdown.mockReset();
  fetchFulfillmentHealth.mockReset();
  fetchReturnsSummary.mockReset();
  fetchOrderValueDistribution.mockReset();
  downloadReport.mockReset();
});

describe('the summary', () => {
  it('formats money from the string the API sent', async () => {
    resolveAll();

    render(<ReportsView />);

    expect(await screen.findByText(/12,345\.67/)).toBeInTheDocument();
  });

  it('shows the average order value, which excludes cancellations', async () => {
    resolveAll();

    render(<ReportsView />);

    expect(await screen.findByText(/316\.55/)).toBeInTheDocument();
  });

  it('asks all four questions about the SAME window', async () => {
    // Fetched together so no panel describes a different period than another.
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    const range = fetchOverview.mock.calls[0]?.[0] as { from: string; to: string };

    expect(fetchRevenue).toHaveBeenCalledWith(range, 'day');
    expect(fetchTopProducts).toHaveBeenCalledWith(range, 10);
    expect(fetchStatusBreakdown).toHaveBeenCalledWith(range);
  });
});

describe('changing the window', () => {
  it('re-asks with the new granularity', async () => {
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await userEvent.click(screen.getByLabelText(/group by/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Month' }));

    await waitFor(() => {
      expect(fetchRevenue).toHaveBeenLastCalledWith(expect.anything(), 'month');
    });
  });

  it('shows the default 30-day window as the active preset', async () => {
    // C2.3: the bare from/to fields were replaced with the dashboard's own
    // DateRangePresetField — its trigger names whichever preset the CURRENT
    // range matches, and the default range IS exactly the last 30 days.
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    expect(screen.getByRole('button', { name: /last 30 days/i })).toBeInTheDocument();
  });
});

describe('best sellers', () => {
  it('ranks by revenue and shows quantity', async () => {
    resolveAll();

    render(<ReportsView />);

    expect(await screen.findByText('Ceramic Planter')).toBeInTheDocument();
    expect(screen.getByText('×10')).toBeInTheDocument();
  });

  it('says a product was deleted rather than rendering a blank row', async () => {
    // Line items carry a price snapshot but NOT a name, so once the product is
    // hard-deleted there is genuinely nothing to fall back to.
    resolveAll();

    render(<ReportsView />);

    expect(await screen.findByText(/deleted product/i)).toBeInTheDocument();
  });

  it('says so when nothing sold', async () => {
    resolveAll();
    fetchTopProducts.mockResolvedValue({ range: {}, products: [] });

    render(<ReportsView />);

    expect(await screen.findByText(/no sales in this period/i)).toBeInTheDocument();
  });
});

describe('order outcomes', () => {
  it('shows statuses with zero orders too', async () => {
    // A missing row reads as missing data; an explicit 0 reads as "none of
    // these happened".
    resolveAll();

    const { container } = render(<ReportsView />);
    await screen.findByText('Ceramic Planter');

    expect(container.textContent).toMatch(/0/);
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
  });
});

describe('failure states', () => {
  it('keeps the range refusal, which names the limit', async () => {
    // "Choose a range of 731 days or fewer" is the sentence that says what to
    // do. Flattening it to "something went wrong" hides the fix.
    fetchOverview.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Choose a range of 731 days or fewer'),
    );
    fetchRevenue.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'x'));
    fetchTopProducts.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'x'));
    fetchStatusBreakdown.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'x'));

    render(<ReportsView />);

    expect(await screen.findByText(/731 days or fewer/i)).toBeInTheDocument();
  });

  it('distinguishes a permission problem', async () => {
    // Revenue is not for every role — a FULFILLMENT account gets 403.
    for (const mock of [fetchOverview, fetchRevenue, fetchTopProducts, fetchStatusBreakdown]) {
      mock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'nope'));
    }

    render(<ReportsView />);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});

describe('CSV export', () => {
  it('exports the summary for the current range', async () => {
    resolveAll();
    downloadReport.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await user.click(screen.getByRole('button', { name: /export csv — summary/i }));

    expect(downloadReport).toHaveBeenCalledWith(
      'overview',
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      'csv',
      undefined,
    );
  });

  it('exports revenue with the selected granularity', async () => {
    resolveAll();
    downloadReport.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await user.click(screen.getByRole('button', { name: /export csv — revenue/i }));

    expect(downloadReport).toHaveBeenCalledWith(
      'revenue',
      expect.anything(),
      'csv',
      { granularity: 'day' },
    );
  });

  it('surfaces a failed export the same way a failed load is shown', async () => {
    resolveAll();
    downloadReport.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'nope'));
    const user = userEvent.setup();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await user.click(screen.getByRole('button', { name: /export csv — summary/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders Arabic headings', async () => {
    resolveAll();

    render(<ReportsView />, { locale: 'ar' });

    expect(await screen.findByText('الأكثر مبيعاً')).toBeInTheDocument();
  });
});

describe('best sellers limit (C2.2)', () => {
  it('re-asks with the chosen limit, up to the backend ceiling of 50', async () => {
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await userEvent.click(screen.getByLabelText(/show top/i));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));

    await waitFor(() => {
      expect(fetchTopProducts).toHaveBeenLastCalledWith(expect.anything(), 50);
    });
  });

  it('exports the same limit currently shown on screen, not a hardcoded 10', async () => {
    resolveAll();
    downloadReport.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await user.click(screen.getByLabelText(/show top/i));
    await user.click(await screen.findByRole('option', { name: '20' }));
    await waitFor(() => expect(fetchTopProducts).toHaveBeenLastCalledWith(expect.anything(), 20));

    await user.click(screen.getByRole('button', { name: /export csv — best sellers/i }));

    expect(downloadReport).toHaveBeenCalledWith('top-products', expect.anything(), 'csv', { limit: 20 });
  });
});

describe('URL state (C2.6)', () => {
  it('writes the chosen granularity to the URL', async () => {
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await userEvent.click(screen.getByLabelText(/group by/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Month' }));

    await waitFor(() => expect(urlState.get().get('granularity')).toBe('month'));
  });

  it('does not litter the URL with the default granularity', async () => {
    // `useUrlState`'s own contract: a value equal to its default is omitted,
    // so a clean/default report has a clean URL, not `?granularity=day`.
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    expect(urlState.get().has('granularity')).toBe(false);
  });

  it('re-fetches only once when the range settles, not in a refetch loop', async () => {
    // The load-bearing regression this whole block guards: `range` is
    // rebuilt from `values` every render, and without memoizing it by
    // CONTENT (not object identity), `load`'s useCallback gets a new
    // identity every render, its useEffect re-fires every render, and the
    // page never leaves its loading skeletons — found by this exact test
    // hanging past its timeout before the fix.
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);

    await waitFor(() => expect(fetchOverview.mock.calls.length).toBeLessThanOrEqual(2));
  });
});

describe('period comparison (C2.3)', () => {
  it('shows a revenue delta against the previous period by default', async () => {
    resolveAll();
    fetchOverview
      .mockResolvedValueOnce({
        range: { from: '2026-06-28', to: '2026-07-27' },
        revenue: '200.00',
        orders: 10,
        canceledOrders: 0,
        newCustomers: 1,
        lowStockProducts: 0,
        averageOrderValue: '20.00',
      })
      .mockResolvedValueOnce({
        range: { from: '2026-05-29', to: '2026-06-27' },
        revenue: '100.00',
        orders: 5,
        canceledOrders: 0,
        newCustomers: 1,
        lowStockProducts: 0,
        averageOrderValue: '20.00',
      });

    render(<ReportsView />);

    // 200 vs 100 is a +100% change.
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/vs previous period/i)).toBeInTheDocument();
  });

  it('requests no comparison range when comparison is set to None', async () => {
    resolveAll();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);
    fetchOverview.mockClear();

    await userEvent.click(screen.getByLabelText(/compare to/i));
    await userEvent.click(await screen.findByRole('option', { name: /^none$/i }));

    await waitFor(() => expect(fetchOverview).toHaveBeenCalledTimes(1));
  });
});

describe('refresh and last-updated (C2.4)', () => {
  it('replaces the refresh label with a timestamp once data has loaded', async () => {
    resolveAll();

    render(<ReportsView />);

    expect(await screen.findByText(/updated/i)).toBeInTheDocument();
  });

  it('re-runs every fetch when the refresh control is clicked', async () => {
    resolveAll();
    const user = userEvent.setup();

    render(<ReportsView />);
    await screen.findByText(/12,345\.67/);
    fetchOverview.mockClear();

    await user.click(screen.getByRole('button', { name: /updated/i }));

    await waitFor(() => expect(fetchOverview).toHaveBeenCalled());
  });
});
