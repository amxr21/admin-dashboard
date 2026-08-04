import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { ApiError } from '@/lib/api';
import { OrderDetail } from '../order-detail';
import type { OrderDetail as Order } from '@/lib/orders-api';

// next-intl's navigation module resolves `next/navigation` in a way Vitest
// cannot follow. Same stub the error-screen tests use.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

/**
 * One order.
 *
 * The property worth pinning hardest: the status control offers ONLY what the
 * server said is legal. Keeping a second copy of the transition table in the
 * UI would mean two sources of truth, and the drift shows up as a button that
 * looks legal and returns 400.
 */

const fetchOrder = vi.hoisted(() => vi.fn());
const changeOrderStatus = vi.hoisted(() => vi.fn());
const updateOrderNotes = vi.hoisted(() => vi.fn());
const createReturn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return { ...actual, fetchOrder, changeOrderStatus, updateOrderNotes };
});

vi.mock('@/lib/returns-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/returns-api')>();
  return { ...actual, createReturn };
});

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'ORD-1024',
    status: 'CONFIRMED',
    total: '59.98',
    paymentMethod: 'card',
    placedAt: '2026-07-01T10:00:00.000Z',
    internalNotes: null,
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
    statusHistory: [
      {
        id: 'h1',
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        note: 'payment cleared',
        changedById: 'u1',
        createdAt: '2026-07-01T11:00:00.000Z',
      },
    ],
    assignment: null,
    nextStatuses: ['SHIPPED', 'CANCELED'],
    ...overrides,
  };
}

beforeEach(() => {
  fetchOrder.mockReset();
  changeOrderStatus.mockReset();
  updateOrderNotes.mockReset();
  createReturn.mockReset();
});

describe('the order itself', () => {
  it('shows line items with the price paid at the time', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText('Ceramic Planter')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    // 29.99 unit, 59.98 line — formatted from strings, never recomputed.
    expect(screen.getAllByText(/59\.98/).length).toBeGreaterThan(0);
  });

  it('says so when a product was deleted rather than rendering a blank row', async () => {
    // Line items carry a price snapshot but NOT a name snapshot, so a
    // hard-deleted product leaves nothing to fall back to.
    fetchOrder.mockResolvedValue(
      makeOrder({
        items: [
          {
            id: 'i1',
            quantity: 1,
            price: '10.00',
            lineTotal: '10.00',
            productId: null,
            product: null,
          },
        ],
      }),
    );

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it('notes a deleted customer instead of showing an empty panel', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ customer: null }));

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText(/customer record has been deleted/i)).toBeInTheDocument();
  });

  it('renders the status history', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText('payment cleared')).toBeInTheDocument();
    expect(screen.getByText(/order placed/i)).toBeInTheDocument();
  });
});

describe('the status control offers only what the server allows', () => {
  it('lists exactly the statuses the API returned', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ nextStatuses: ['SHIPPED', 'CANCELED'] }));

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByLabelText(/move to/i));

    expect(await screen.findByRole('option', { name: 'Shipped' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Canceled' })).toBeInTheDocument();
    // DELIVERED is not reachable from CONFIRMED, so it must not be offered.
    expect(screen.queryByRole('option', { name: 'Delivered' })).not.toBeInTheDocument();
  });

  it('renders no control at all on a terminal order', async () => {
    // A disabled dropdown that can never be used is noise.
    fetchOrder.mockResolvedValue(
      makeOrder({ status: 'CANCELED', nextStatuses: [] }),
    );

    render(<OrderDetail id="o1" />);

    await screen.findByText(/cannot move further/i);
    expect(screen.queryByLabelText(/move to/i)).not.toBeInTheDocument();
  });

  it('sends the chosen status and the note', async () => {
    fetchOrder.mockResolvedValue(makeOrder());
    changeOrderStatus.mockResolvedValue(makeOrder({ status: 'SHIPPED' }));

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByLabelText(/move to/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Shipped' }));
    await userEvent.type(screen.getByLabelText(/note/i), 'left the warehouse');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(changeOrderStatus).toHaveBeenCalledWith('o1', 'SHIPPED', 'left the warehouse');
    });
  });

  it('surfaces a refused transition instead of failing silently', async () => {
    fetchOrder.mockResolvedValue(makeOrder());
    changeOrderStatus.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Cannot move an order from CONFIRMED to DELIVERED'),
    );

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByLabelText(/move to/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Shipped' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('requesting a return', () => {
  it('offers it only when RETURNED is a legal next status', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ nextStatuses: ['SHIPPED', 'CANCELED'] }));

    render(<OrderDetail id="o1" />);

    await screen.findByText('Ceramic Planter');
    expect(screen.queryByRole('button', { name: /request return/i })).not.toBeInTheDocument();
  });

  it('shows the button for a DELIVERED order and submits selected items', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({ status: 'DELIVERED', nextStatuses: ['RETURNED'] }),
    );
    createReturn.mockResolvedValue({
      id: 'r1',
      rmaNumber: 'RMA-ABCD1234',
      reason: 'damaged',
      status: 'REQUESTED',
      resolution: 'NONE',
      refundAmount: null,
      restocked: false,
      createdAt: '2026-07-02T00:00:00.000Z',
      order: { id: 'o1', orderNumber: 'ORD-1024', status: 'DELIVERED' },
      customer: null,
      items: [],
    });

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: /request return/i }));

    const dialog = await screen.findByRole('dialog');

    // Select the one line item and give it a reason.
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'arrived damaged');
    await userEvent.click(within(dialog).getByRole('button', { name: /request return/i }));

    await waitFor(() => {
      expect(createReturn).toHaveBeenCalledWith({
        orderId: 'o1',
        reason: 'arrived damaged',
        items: [{ orderItemId: 'i1', quantity: 2 }],
      });
    });

    expect(await screen.findByText(/RMA-ABCD1234/)).toBeInTheDocument();
  });

  it('will not submit without a reason', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({ status: 'DELIVERED', nextStatuses: ['RETURNED'] }),
    );

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: /request return/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));

    expect(within(dialog).getByRole('button', { name: /request return/i })).toBeDisabled();
    expect(createReturn).not.toHaveBeenCalled();
  });
});

describe('failure states', () => {
  it('shows the not-found screen for a missing order', async () => {
    // "Doesn't exist" and "something went wrong" are different screens —
    // only one of them is worth a retry button.
    fetchOrder.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Order not found'));

    render(<OrderDetail id="nope" />);

    expect(await screen.findByText(/doesn't exist/i)).toBeInTheDocument();
    // And no "server had a problem", which would invite a pointless retry.
    expect(screen.queryByText(/server had a problem/i)).not.toBeInTheDocument();
  });

  it('shows a retryable error for a server failure', async () => {
    fetchOrder.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });
});

describe('internal notes', () => {
  it('disables Save until the text actually differs from what is saved', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ internalNotes: 'existing note' }));

    render(<OrderDetail id="o1" />);

    const textarea = await screen.findByPlaceholderText(/staff-only/i);
    expect(textarea).toHaveValue('existing note');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.type(textarea, '!');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('saves the edited notes', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ internalNotes: null }));
    updateOrderNotes.mockResolvedValue(makeOrder({ internalNotes: 'called twice, no answer' }));

    render(<OrderDetail id="o1" />);

    const textarea = await screen.findByPlaceholderText(/staff-only/i);
    await userEvent.type(textarea, 'called twice, no answer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateOrderNotes).toHaveBeenCalledWith('o1', 'called twice, no answer');
    });
    // Save disables again once the saved value matches what's shown.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('surfaces a failed save instead of losing the edit silently', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ internalNotes: null }));
    updateOrderNotes.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<OrderDetail id="o1" />);

    const textarea = await screen.findByPlaceholderText(/staff-only/i);
    await userEvent.type(textarea, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // The typed text is not thrown away on a failed save.
    expect(textarea).toHaveValue('x');
  });
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderDetail id="o1" />, { locale: 'ar' });

    expect(await screen.findByText('العميل')).toBeInTheDocument();
  });
});
