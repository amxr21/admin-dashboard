import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { OrdersTable } from '../orders-table';
import type { OrderListRow } from '@/lib/orders-api';

/**
 * The order list.
 *
 * Same discipline as every other table here: filtering happens on the SERVER,
 * and a failed request renders as an error rather than as an empty list —
 * "you have no orders" and "loading failed" are different statements and only
 * one of them is worth retrying.
 */

// next-intl's navigation module resolves `next/navigation` in a way Vitest
// cannot follow. Same stub the error-screen tests use.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

// The dashboard's Cancelled KPI tile deep-links here via `?status=`, read
// with `useSearchParams` — no query string in these tests, same as visiting
// the page directly.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const fetchOrders = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return { ...actual, fetchOrders };
});

function makeOrder(overrides: Partial<OrderListRow> = {}): OrderListRow {
  return {
    id: 'o1',
    orderNumber: 'ORD-1024',
    status: 'PENDING',
    total: '59.98',
    placedAt: '2026-07-01T10:00:00.000Z',
    paymentMethod: 'card',
    customer: { id: 'c1', name: 'Ali', email: 'ali@example.com' },
    itemCount: 2,
    ...overrides,
  };
}

function resolveWith(orders: OrderListRow[], total = orders.length) {
  fetchOrders.mockResolvedValue({
    orders,
    total,
    page: 1,
    pageSize: 20,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  });
}

beforeEach(() => {
  fetchOrders.mockReset();
});

describe('rendering', () => {
  it('shows an order once loaded', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);

    expect(await screen.findByText('ORD-1024')).toBeInTheDocument();
    expect(screen.getByText('Ali')).toBeInTheDocument();
  });

  it('formats the total from the decimal string', async () => {
    // The API sends "59.98". It renders as currency and is never parsed into
    // state to do arithmetic on.
    resolveWith([makeOrder({ total: '1234.50' })]);

    render(<OrdersTable />);

    expect(await screen.findByText(/1,234\.50/)).toBeInTheDocument();
  });

  it('names an order with no customer rather than leaving a blank cell', async () => {
    // customerId is SetNull, so an order can outlive its customer.
    resolveWith([makeOrder({ customer: null })]);

    render(<OrdersTable />);

    expect(await screen.findByText(/guest/i)).toBeInTheDocument();
  });

  it('links the order number to its detail page', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);

    const link = await screen.findByRole('link', { name: /ORD-1024/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1'));
  });
});

describe('filtering happens on the server', () => {
  it('sends the status filter', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Shipped' }));

    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'SHIPPED' }),
      );
    });
  });

  it('omits the status parameter entirely when set to all', async () => {
    // The API validates the enum strictly, so "no filter" must mean "no
    // parameter" rather than the literal string "all".
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    expect(fetchOrders).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it('sends the search term rather than filtering locally', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.type(screen.getByLabelText('Search'), 'ali');

    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'ali' }),
      );
    });
  });

  it('sends a picked date as part of the range', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByLabelText(/placed from/i));
    await userEvent.click(await screen.findByText('20', { selector: 'button' }));

    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-20$/) }),
      );
    });
  });
});

describe('failure states', () => {
  it('renders an error, not an empty list', async () => {
    fetchOrders.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<OrdersTable />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });

  it('distinguishes an expired session', async () => {
    fetchOrders.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));

    render(<OrdersTable />);

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });

  it('shows the empty state when there genuinely are none', async () => {
    resolveWith([]);

    render(<OrdersTable />);

    expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders Arabic column headers', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />, { locale: 'ar' });

    expect(await screen.findByText('العميل')).toBeInTheDocument();
  });
});
