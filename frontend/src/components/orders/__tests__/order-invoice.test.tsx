import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { render, screen, within } from '@/test/render';
import { ApiError } from '@/lib/api';
import { OrderInvoice } from '../order-invoice';
import type { OrderDetail as Order } from '@/lib/orders-api';

/**
 * The printable invoice.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────
 * The invoice had NO test coverage at all, while being the most consequential
 * order surface: it is a tax document, it goes to a customer, and it prints.
 * It also carried the more serious half of one bug — it stated a single grand
 * total with no tax line, so the one figure an accountant needs to verify was
 * missing from the document that exists to state it.
 *
 * Everything here is a snapshot by design (see the component's own note), so
 * the assertions are about what reaches paper, not about live data.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href: typeof href === 'string' ? href : JSON.stringify(href), ...props }, children as ReactNode),
}));

const fetchOrder = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return { ...actual, fetchOrder };
});

// The invoice reads store identity (name, tax id, logo) from settings. Stubbed
// rather than wrapped in a provider: none of it is what these tests are about,
// and an unmocked `useAppSettings` throws outside its provider.
vi.mock('@/components/providers/settings-provider', () => ({
  useAppSettings: () => ({
    storeName: 'Test Store',
    storeTagline: null,
    storeAddress: null,
    storeSupportEmail: null,
    storeSupportPhone: null,
    storeTaxId: 'TRN-100',
    logoUrl: null,
    storeCurrency: 'AED',
  }),
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'ORD-1024',
    status: 'CONFIRMED',
    branch: null,
    /**
     * Every money figure here is DELIBERATELY distinct.
     *
     * The obvious fixture (one line of 2 × 29.99, total 59.98) makes the line
     * total and the grand total the same string, so a query for either matches
     * two cells and the test fails for a reason that has nothing to do with
     * what it is checking. Distinct values keep each assertion pointed at one
     * number.
     */
    total: '58.80',
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
        price: '28.00',
        lineTotal: '56.00',
        productId: 'p1',
        product: { id: 'p1', name: 'Ceramic Planter', sku: 'SKU-1', imageUrl: null },
      },
    ],
    statusHistory: [],
    ...overrides,
  } as Order;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the invoice states what was charged', () => {
  it('prints subtotal and tax, not just a grand total', async () => {
    /**
     * The whole point of the document. A customer or an accountant reading it
     * must be able to see the tax that was charged; a single combined figure
     * makes that unverifiable from the record itself.
     */
    fetchOrder.mockResolvedValue(makeOrder({ subtotal: '56.00', taxAmount: '2.80' }));

    render(<OrderInvoice id="o1" />);

    await screen.findByText('ORD-1024');

    // Scoped to the FOOTER: the subtotal equals the single line total, as it
    // genuinely does on a one-line order, so an unscoped query would match the
    // line-item cell too and prove nothing about the summary.
    //
    // The table has thead/tbody/tfoot, and all three carry role="rowgroup" —
    // so the footer is index 2, not 1. Taking index 1 silently asserts against
    // the line items instead, which is how this read as "value not rendered"
    // when it was rendered all along, one section over.
    const footer = screen.getAllByRole('rowgroup')[2];
    expect(footer).toBeDefined();
    expect(within(footer!).getByText(/56\.00/)).toBeInTheDocument();
    expect(within(footer!).getByText(/2\.80/)).toBeInTheDocument();
    expect(within(footer!).getByText(/58\.80/)).toBeInTheDocument();
  });

  it('omits both lines on a historical order rather than inventing a zero tax', async () => {
    // An order predating these columns has neither. Printing "Tax 0.00" on a
    // real invoice would be a fabricated fact on a document people rely on.
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderInvoice id="o1" />);

    await screen.findByText('ORD-1024');
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
    expect(screen.queryByText('Tax')).not.toBeInTheDocument();
    // The grand total still prints — hiding the two new rows must not take the
    // one line every invoice has always had with them.
    const footer = screen.getAllByRole('rowgroup')[2];
    expect(footer).toBeDefined();
    expect(within(footer!).getByText(/58\.80/)).toBeInTheDocument();
  });
});

describe('the invoice identifies the order and the seller', () => {
  it('shows the order number and the store identity', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderInvoice id="o1" />);

    expect(await screen.findByText('ORD-1024')).toBeInTheDocument();
    expect(screen.getByText('Test Store')).toBeInTheDocument();
  });

  it('lists the line items it is charging for', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderInvoice id="o1" />);

    expect(await screen.findByText('Ceramic Planter')).toBeInTheDocument();
  });
});

describe('failure states', () => {
  it('shows an error screen rather than a blank page when the order cannot be loaded', async () => {
    // A blank printable page is the worst outcome here: someone prints it
    // before noticing nothing rendered.
    fetchOrder.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Order not found'));

    render(<OrderInvoice id="o1" />);

    expect(await screen.findByRole('heading')).toBeInTheDocument();
    expect(screen.queryByText('ORD-1024')).not.toBeInTheDocument();
  });
});
