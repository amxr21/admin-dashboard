import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/render';
import { DashboardOverview } from '../dashboard-overview';

/**
 * The dashboard home page — first test coverage for this file (previously
 * zero). Scope here is C1.2 (the KPI row: 4 tiles → 6, adding average order
 * value and units sold) plus the load contract the rest of the page depends
 * on; the widgets below the strip already have their own component tests.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  // RevenueChart's C1.6 drill-down click handler needs this.
  useRouter: () => ({ push: vi.fn() }),
}));

const fetchOverview = vi.hoisted(() => vi.fn());
const fetchRevenue = vi.hoisted(() => vi.fn());
const fetchTopProducts = vi.hoisted(() => vi.fn());
const fetchStatusBreakdown = vi.hoisted(() => vi.fn());
const fetchFulfillmentHealth = vi.hoisted(() => vi.fn());
const fetchNeedsAttention = vi.hoisted(() => vi.fn());
const fetchReturnsSummary = vi.hoisted(() => vi.fn());
const fetchOrderValueDistribution = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return {
    ...actual,
    fetchOverview,
    fetchRevenue,
    fetchTopProducts,
    fetchStatusBreakdown,
    fetchFulfillmentHealth,
    fetchNeedsAttention,
    fetchReturnsSummary,
    fetchOrderValueDistribution,
  };
});

const fetchAudit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/audit-api', () => ({ fetchAudit }));

function resolveAll() {
  fetchOverview.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    revenue: '12345.67',
    orders: 42,
    canceledOrders: 3,
    newCustomers: 7,
    lowStockProducts: 2,
    unitsSold: 128,
    averageOrderValue: '316.55',
  });
  fetchRevenue.mockResolvedValue({
    range: { from: '2026-06-28', to: '2026-07-27' },
    granularity: 'day',
    points: [{ date: '2026-07-01', revenue: '100.00', orders: 2 }],
  });
  fetchTopProducts.mockResolvedValue({ range: {}, products: [] });
  fetchStatusBreakdown.mockResolvedValue({ range: {}, statuses: [] });
  fetchFulfillmentHealth.mockResolvedValue({ range: {}, avgHoursInStatus: [], needsAttention: [] });
  fetchNeedsAttention.mockResolvedValue({
    returnsAwaitingApproval: { count: 0, items: [] },
    reviewsAwaitingModeration: { count: 0, items: [] },
    unassignedDeliveries: { count: 0, items: [] },
    outOfStockWithOpenOrders: { count: 0, items: [] },
  });
  fetchReturnsSummary.mockResolvedValue({
    range: {},
    returnCount: 0,
    orderCount: 0,
    returnRate: 0,
    refundValue: '0.00',
    unitsReturned: 0,
    topReturnedProducts: [],
  });
  fetchOrderValueDistribution.mockResolvedValue({ range: {}, buckets: [] });
  fetchAudit.mockResolvedValue({ entries: [], total: 0 });
}

beforeEach(() => {
  fetchOverview.mockReset();
  fetchRevenue.mockReset();
  fetchTopProducts.mockReset();
  fetchStatusBreakdown.mockReset();
  fetchFulfillmentHealth.mockReset();
  fetchNeedsAttention.mockReset();
  fetchReturnsSummary.mockReset();
  fetchOrderValueDistribution.mockReset();
  fetchAudit.mockReset();
});

describe('KPI row (C1.2 — 6 tiles, not 4)', () => {
  it('renders average order value and units sold alongside the original four', async () => {
    resolveAll();

    render(<DashboardOverview />);

    expect(await screen.findByText(/12,345\.67/)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/316\.55/)).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('gives average order value a definition tooltip, since its denominator excludes cancellations', async () => {
    resolveAll();

    render(<DashboardOverview />);
    await screen.findByText(/316\.55/);

    expect(
      screen.getByRole('button', { name: /average order/i }),
    ).toBeInTheDocument();
  });

  it('does not claim a period-over-period comparison for average order value', async () => {
    // No `previousOverview`-based delta is wired for this tile — asserting
    // its ABSENCE matters here, since a fabricated delta would misreport a
    // trend the code never actually computed.
    resolveAll();

    render(<DashboardOverview />);
    await screen.findByText(/316\.55/);

    expect(screen.getByText(/no comparison available/i)).toBeInTheDocument();
  });
});

describe('one window, every question', () => {
  it('asks overview, revenue, top products and status breakdown about the same range', async () => {
    resolveAll();

    render(<DashboardOverview />);
    await screen.findByText(/12,345\.67/);

    const range = fetchOverview.mock.calls[0]?.[0] as { from: string; to: string };
    expect(fetchRevenue).toHaveBeenCalledWith(range, 'day');
    expect(fetchTopProducts).toHaveBeenCalledWith(range, 5);
    expect(fetchStatusBreakdown).toHaveBeenCalledWith(range);
  });
});
