import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import { BranchSummary } from '../branch-summary';
import type { BranchComparisonRow } from '@/lib/reports-api';

/**
 * The per-branch dashboard summary.
 *
 * The property most worth pinning is that a single-branch business sees
 * NOTHING. A comparison of one repeats the KPI strip directly above it under a
 * heading promising more, and the obvious "improvement" later is to render it
 * anyway with an empty state — which is worse, because having one branch is
 * not a problem needing an explanation.
 */

const fetchBranchComparison = vi.fn();

vi.mock('@/lib/reports-api', () => ({
  fetchBranchComparison: (...args: unknown[]) => fetchBranchComparison(...args),
}));

const reload = vi.fn();
const writeBranchId = vi.fn();
vi.mock('@/lib/auth-storage', () => ({
  writeBranchId: (...args: unknown[]) => writeBranchId(...args),
}));

const RANGE = { from: '2026-09-01', to: '2026-09-30' };

function row(overrides: Partial<BranchComparisonRow> = {}): BranchComparisonRow {
  return {
    id: 'b1',
    name: 'Marina',
    code: 'MAR',
    isSellingPoint: true,
    businessId: 'biz1',
    businessName: 'Coffee Co',
    revenue: '1200.50',
    orderCount: 42,
    unitsSold: 96,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { reload });
});

describe('BranchSummary', () => {
  it('renders nothing for a single-branch business', async () => {
    fetchBranchComparison.mockResolvedValue({ range: RANGE, branches: [row()] });

    const { container } = render(<BranchSummary range={RANGE} />);

    await waitFor(() => expect(fetchBranchComparison).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lists every branch once there is more than one', async () => {
    fetchBranchComparison.mockResolvedValue({
      range: RANGE,
      branches: [row(), row({ id: 'b2', name: 'Downtown', code: 'DTN' })],
    });

    render(<BranchSummary range={RANGE} />);

    expect(await screen.findByRole('button', { name: /Marina/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Downtown/ })).toBeInTheDocument();
  });

  it('includes a branch that sold nothing, rather than omitting it', async () => {
    // A branch at zero is a real and interesting answer. Grouping over orders
    // alone would drop the row entirely and quietly answer a different
    // question than the one the heading asks.
    fetchBranchComparison.mockResolvedValue({
      range: RANGE,
      branches: [row(), row({ id: 'b2', name: 'Quiet', revenue: '0', orderCount: 0, unitsSold: 0 })],
    });

    render(<BranchSummary range={RANGE} />);

    expect(await screen.findByRole('button', { name: /Quiet/ })).toBeInTheDocument();
  });

  it('switching to a branch writes it and reloads, like the topbar switcher', async () => {
    fetchBranchComparison.mockResolvedValue({
      range: RANGE,
      branches: [row(), row({ id: 'b2', name: 'Downtown' })],
    });

    render(<BranchSummary range={RANGE} />);
    (await screen.findByRole('button', { name: /Downtown/ })).click();

    // A local state update would leave the rest of the shell showing another
    // branch's data under this branch's name.
    expect(writeBranchId).toHaveBeenCalledWith('b2');
    expect(reload).toHaveBeenCalled();
  });

  it('clears stale rows when a reload fails', async () => {
    fetchBranchComparison.mockRejectedValue(new Error('boom'));

    render(<BranchSummary range={RANGE} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
