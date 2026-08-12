import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { OrderStatusTimeline } from '../order-status-timeline';
import type { TimelineEvent } from '@/lib/orders-api';

/**
 * C5.4 — the order timeline merges status moves, staff edits, delivery-status
 * pings and return decisions into one chronological list. "Emails sent" is
 * deliberately absent (see orders.service.ts's `getOrderTimeline` for why)
 * so there's nothing to pin here for that category.
 */

const fetchOrderTimeline = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return { ...actual, fetchOrderTimeline };
});

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e1',
    kind: 'status',
    action: 'order.status.changed',
    actorName: 'Owner Person',
    createdAt: '2026-07-01T11:00:00.000Z',
    detail: { fromStatus: 'PENDING', toStatus: 'CONFIRMED', note: null },
    ...overrides,
  };
}

beforeEach(() => {
  fetchOrderTimeline.mockReset();
});

describe('the order-placed anchor', () => {
  it('always renders, even with zero events', async () => {
    fetchOrderTimeline.mockResolvedValue([]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText(/order placed/i)).toBeInTheDocument();
  });
});

describe('a status event', () => {
  it('shows the from/to badges and note', async () => {
    fetchOrderTimeline.mockResolvedValue([
      event({ detail: { fromStatus: 'PENDING', toStatus: 'SHIPPED', note: 'left the warehouse' } }),
    ]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.getByText('left the warehouse')).toBeInTheDocument();
  });
});

describe('a note event', () => {
  it('names who wrote it and shows the note text', async () => {
    fetchOrderTimeline.mockResolvedValue([
      event({
        kind: 'note',
        action: 'order.note.added',
        actorName: 'support@example.test',
        detail: { body: 'called twice, no answer' },
      }),
    ]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText(/support@example\.test/)).toBeInTheDocument();
    expect(screen.getByText('called twice, no answer')).toBeInTheDocument();
  });
});

describe('a delivery-ping event', () => {
  it('shows the courier-reported status', async () => {
    fetchOrderTimeline.mockResolvedValue([
      event({
        kind: 'delivery',
        action: 'delivery.assignment.status_changed',
        actorName: 'Sami',
        detail: { deliveryStatus: { from: 'ASSIGNED', to: 'PICKED_UP' } },
      }),
    ]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText('Picked up')).toBeInTheDocument();
    expect(screen.getByText(/Sami/)).toBeInTheDocument();
  });
});

describe('a return event', () => {
  it('shows the RMA number, status and resolution', async () => {
    fetchOrderTimeline.mockResolvedValue([
      event({
        kind: 'return',
        action: 'return.approved',
        actorName: 'owner@example.test',
        detail: {
          rmaNumber: 'RMA-ABCD1234',
          status: 'APPROVED',
          resolution: 'STORE_CREDIT',
          refundAmount: null,
        },
      }),
    ]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText('RMA-ABCD1234')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Store credit')).toBeInTheDocument();
  });

  it('does not show a resolution badge for a rejected return', async () => {
    fetchOrderTimeline.mockResolvedValue([
      event({
        kind: 'return',
        action: 'return.rejected',
        detail: {
          rmaNumber: 'RMA-EFGH5678',
          status: 'REJECTED',
          resolution: 'NONE',
          refundAmount: null,
        },
      }),
    ]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText('RMA-EFGH5678')).toBeInTheDocument();
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });
});

describe('an actor that no longer exists', () => {
  it('renders a fallback label instead of a blank name', async () => {
    fetchOrderTimeline.mockResolvedValue([
      event({ kind: 'note', action: 'order.note.added', actorName: null, detail: { body: 'x' } }),
    ]);

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
  });
});

describe('failure and loading', () => {
  it('falls back to an empty state rather than blocking when the fetch fails', async () => {
    fetchOrderTimeline.mockRejectedValue(new Error('boom'));

    render(<OrderStatusTimeline orderId="o1" placedAt="2026-07-01T00:00:00.000Z" />);

    expect(await screen.findByText(/order placed/i)).toBeInTheDocument();
  });
});
