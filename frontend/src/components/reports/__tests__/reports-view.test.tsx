import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ReportsView } from '../reports-view';

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

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return {
    ...actual,
    fetchOverview,
    fetchRevenue,
    fetchTopProducts,
    fetchStatusBreakdown,
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
}

beforeEach(() => {
  fetchOverview.mockReset();
  fetchRevenue.mockReset();
  fetchTopProducts.mockReset();
  fetchStatusBreakdown.mockReset();
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

  it('offers a reset back to the default window', async () => {
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

describe('localisation', () => {
  it('renders Arabic headings', async () => {
    resolveAll();

    render(<ReportsView />, { locale: 'ar' });

    expect(await screen.findByText('الأكثر مبيعاً')).toBeInTheDocument();
  });
});
