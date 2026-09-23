import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import type { DayTimeline } from '@/lib/reports-api';
import { DayTimelineWidget } from '../day-timeline-widget';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const timeline: DayTimeline = {
  range: { from: '2026-09-23', to: '2026-09-23' },
  truncated: false,
  events: [
    {
      id: 'order-1',
      at: '2026-09-23T08:30:00.000Z',
      kind: 'order.placed',
      actor: null,
      actorRole: null,
      entityId: 'order-1',
      label: 'ORD-1001',
      amount: '125.00',
      status: 'PENDING',
      branch: { id: 'branch-1', name: 'Marina' },
    },
  ],
};

describe('DayTimelineWidget', () => {
  it('translates event kinds and shows source, branch, and amount', () => {
    render(<DayTimelineWidget data={timeline} />);

    expect(screen.getByText('Order placed')).toBeInTheDocument();
    expect(screen.queryByText('order.placed')).not.toBeInTheDocument();
    expect(screen.getByText(/storefront/)).toBeInTheDocument();
    expect(screen.getByText(/Branch:/)).toBeInTheDocument();
    expect(screen.getByText('Marina')).toBeInTheDocument();
    expect(screen.getByText(/125\.00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Order placed/ })).toHaveAttribute(
      'href',
      '/admin/orders/order-1',
    );
  });

  it('renders the event kind and branch label in Arabic', () => {
    render(<DayTimelineWidget data={timeline} />, { locale: 'ar' });

    expect(screen.getByText('طلب جديد')).toBeInTheDocument();
    expect(screen.getByText(/الفرع:/)).toBeInTheDocument();
  });
});
