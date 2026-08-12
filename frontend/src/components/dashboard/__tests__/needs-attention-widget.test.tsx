import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { NeedsAttentionWidget } from '../needs-attention-widget';
import type { NeedsAttention } from '@/lib/reports-api';

/**
 * C1.5's umbrella queue — four sources, one widget. The properties worth
 * pinning: an empty bucket renders no heading at all (not an empty one), the
 * total badge sums correctly, and each row links somewhere real.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const EMPTY: NeedsAttention = {
  returnsAwaitingApproval: { count: 0, items: [] },
  reviewsAwaitingModeration: { count: 0, items: [] },
  unassignedDeliveries: { count: 0, items: [] },
  outOfStockWithOpenOrders: { count: 0, items: [] },
};

describe('empty state', () => {
  it('reads as "all clear" when every bucket is empty', () => {
    render(<NeedsAttentionWidget data={EMPTY} />);

    expect(screen.getByText(/nothing needs your attention/i)).toBeInTheDocument();
  });

  it('shows no total badge when there is nothing to count', () => {
    render(<NeedsAttentionWidget data={EMPTY} />);

    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});

describe('non-empty buckets', () => {
  const data: NeedsAttention = {
    returnsAwaitingApproval: {
      count: 1,
      items: [{ id: 'r1', rmaNumber: 'RMA-1', orderNumber: 'ORD-1', createdAt: '2026-07-01T00:00:00.000Z' }],
    },
    reviewsAwaitingModeration: { count: 0, items: [] },
    unassignedDeliveries: {
      count: 5,
      items: [
        { id: 'o1', orderNumber: 'ORD-2', status: 'CONFIRMED', placedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'o2', orderNumber: 'ORD-3', status: 'PENDING', placedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'o3', orderNumber: 'ORD-4', status: 'PENDING', placedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'o4', orderNumber: 'ORD-5', status: 'PENDING', placedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'o5', orderNumber: 'ORD-6', status: 'PENDING', placedAt: '2026-07-01T00:00:00.000Z' },
      ],
    },
    outOfStockWithOpenOrders: { count: 0, items: [] },
  };

  it('sums every category into one total badge', () => {
    render(<NeedsAttentionWidget data={data} />);

    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('renders no heading for a bucket with zero items', () => {
    render(<NeedsAttentionWidget data={data} />);

    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/out of stock/i)).not.toBeInTheDocument();
  });

  it('links a return row to the pre-filtered returns list', () => {
    render(<NeedsAttentionWidget data={data} />);

    const heading = screen.getByRole('link', { name: /1 return awaiting approval/i });
    expect(heading).toHaveAttribute('href', '/admin/returns?status=REQUESTED');
  });

  it('caps the preview at 3 rows and offers a "view all" link for the rest', () => {
    render(<NeedsAttentionWidget data={data} />);

    expect(screen.getByText('ORD-2')).toBeInTheDocument();
    expect(screen.getByText('ORD-3')).toBeInTheDocument();
    expect(screen.getByText('ORD-4')).toBeInTheDocument();
    expect(screen.queryByText('ORD-5')).not.toBeInTheDocument();
    expect(screen.getByText(/view all 5/i)).toBeInTheDocument();
  });
});

describe('loading and unknown states', () => {
  it('shows skeletons while loading', () => {
    const { container } = render(<NeedsAttentionWidget data={null} isLoading />);

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('shows a neutral empty state when data failed to load, not "all clear"', () => {
    // "All clear" is a POSITIVE claim about the backlog; an unknown state
    // must not accidentally make that claim.
    render(<NeedsAttentionWidget data={null} />);

    expect(screen.queryByText(/nothing needs your attention/i)).not.toBeInTheDocument();
  });
});
