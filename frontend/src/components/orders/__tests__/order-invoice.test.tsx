import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { render, screen } from '@/test/render';
import { OrderInvoice } from '../order-invoice';
import type { OrderDetail as Order } from '@/lib/orders-api';

/**
 * The printable invoice's Subtotal/Tax/Total breakdown.
 *
 * The property worth pinning: `subtotal`/`taxAmount` are null on any order
 * placed before this was tracked, and that must render as NO breakdown row
 * at all (just the existing single Total, unchanged) — never a fabricated
 * 0.00 that looks like a confirmed tax-free order.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const fetchOrder = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return { ...actual, fetchOrder };
});

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'ORD-1024',
    status: 'CONFIRMED',
    total: '59.98',
    subtotal: null,
    taxAmount: null,
    paymentMethod: 'card',
    placedAt: '2026-07-01T10:00:00.000Z',
    notes: [],
    customer: {
      id: 'c1',
      name: 'Ali',
      email: 'ali@example.com',
      phone: '+971500000000',
      city: 'Dubai',
      country: 'UAE',
    },
    items: [
      {
        id: 'i1',
        quantity: 2,
        price: '29.99',
        lineTotal: '59.98',
        productId: 'p1',
        product: { id: 'p1', name: 'Ceramic Planter', sku: 'SKU-1', imageUrl: null },
      },
    ],
    statusHistory: [],
    assignment: null,
    nextStatuses: [],
    ...overrides,
  };
}

describe('subtotal/tax breakdown', () => {
  it('renders only the Total row when subtotal/taxAmount were never recorded', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderInvoice id="o1" />);

    expect(await screen.findByText('Order total')).toBeInTheDocument();
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
    expect(screen.queryByText('Tax')).not.toBeInTheDocument();
  });

  it('renders Subtotal, Tax and the grand total when all three are recorded', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({ total: '62.98', subtotal: '59.98', taxAmount: '3.00' }),
    );

    render(<OrderInvoice id="o1" />);

    expect(await screen.findByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('Order total')).toBeInTheDocument();
  });

  it('never shows a fabricated 0.00 tax row when taxAmount is null but subtotal is set', async () => {
    // Should not happen in practice (both are written together), but the
    // render logic checks each field independently — worth pinning that a
    // partially-null row still never invents the missing half.
    fetchOrder.mockResolvedValue(makeOrder({ subtotal: '59.98', taxAmount: null }));

    render(<OrderInvoice id="o1" />);

    expect(await screen.findByText('Subtotal')).toBeInTheDocument();
    expect(screen.queryByText('Tax')).not.toBeInTheDocument();
  });
});
