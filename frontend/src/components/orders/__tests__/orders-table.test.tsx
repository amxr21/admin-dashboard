import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/sonner';
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

/**
 * A STATEFUL stand-in for the URL bar.
 *
 * Search, status, the date range and the page all round-trip through the query
 * string now. A mock that accepted a `replace()` and then kept reporting an
 * empty `useSearchParams()` would break the loop this component depends on: it
 * writes the filter, reads back "no filter", and never re-fetches. Every
 * assertion below about applying a filter is really an assertion about that
 * round trip, so the mock has to hold the value the way a browser would.
 */
const urlState = vi.hoisted(() => {
  let current = new URLSearchParams();
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    reset: () => {
      current = new URLSearchParams();
    },
    write: (href: string) => {
      current = new URLSearchParams(href.split('?')[1] ?? '');
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('@/i18n/navigation', () => ({
  // `href` may be an object (`{ pathname, query }`, as the order-number
  // column's link now sends — see C5.1) or a plain string; both render as-is
  // so a test can assert on either shape.
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement(
      'a',
      { href: typeof href === 'string' ? href : JSON.stringify(href), ...props },
      children as ReactNode,
    ),
  useRouter: () => ({
    push: (href: string) => urlState.write(href),
    replace: (href: string) => urlState.write(href),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/admin/orders',
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

const fetchOrders = vi.hoisted(() => vi.fn());
const bulkChangeOrderStatus = vi.hoisted(() => vi.fn());
const previewBulkStatusChange = vi.hoisted(() => vi.fn());
const exportOrdersCsv = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return { ...actual, fetchOrders, bulkChangeOrderStatus, previewBulkStatusChange, exportOrdersCsv };
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
  // Filters persist in the URL now, so without this a filter applied in one
  // test would leak into the next one's initial fetch.
  urlState.reset();
  fetchOrders.mockReset();
  bulkChangeOrderStatus.mockReset();
  previewBulkStatusChange.mockReset();
  exportOrdersCsv.mockReset();
  exportOrdersCsv.mockResolvedValue(undefined);
  // Non-terminal, no assignment overlap — the common case, so existing
  // "apply and confirm" tests don't need their own preview setup.
  previewBulkStatusChange.mockResolvedValue({
    eligibleCount: 1,
    ineligibleCount: 0,
    withActiveAssignment: 0,
    isTerminal: false,
  });
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
    expect(link.getAttribute('href')).toContain('"pathname":"/admin/orders/o1"');
  });

  it('carries the current filters into the row link, so Prev/Next (C5.1) can reconstruct the list', async () => {
    urlState.write('/admin/orders?status=SHIPPED&search=ali');
    resolveWith([makeOrder()]);

    render(<OrdersTable />);

    const link = await screen.findByRole('link', { name: /ORD-1024/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('"status":"SHIPPED"');
    expect(href).toContain('"search":"ali"');
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

describe('server-side sort', () => {
  // Only sortable columns render a sort button, all sharing the identical
  // accessible name "Sort ascending"/"Sort descending" (data-table.tsx),
  // so a button is picked by its position AMONG SORTABLE columns, same
  // convention data-table.test.tsx itself uses. Column order is orderNumber,
  // customer (not sortable), placedAt, items (not sortable), total, status —
  // so the sortable buttons are [orderNumber, placedAt, total, status].
  const TOTAL_BUTTON_INDEX = 2;

  it('sends sort + dir when a sortable column header is clicked, and writes it to the URL', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(
      screen.getAllByRole('button', { name: /sort ascending/i })[TOTAL_BUTTON_INDEX]!,
    );

    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'total', dir: 'asc' }),
      );
    });
    expect(urlState.get().get('sort')).toBe('total');
    // asc is the default direction and is omitted from the URL, matching the
    // same "common case stays short" convention resource-table.tsx uses.
    expect(urlState.get().get('dir')).toBeNull();
  });

  it('reverses direction on a second click of the same column, then clears on a third', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(
      screen.getAllByRole('button', { name: /sort ascending/i })[TOTAL_BUTTON_INDEX]!,
    );
    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'total', dir: 'asc' }),
      );
    });

    // Now sorted asc, so the SAME button reads "Sort descending".
    await userEvent.click(screen.getByRole('button', { name: /sort descending/i }));
    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'total', dir: 'desc' }),
      );
    });

    await userEvent.click(
      screen.getAllByRole('button', { name: /sort ascending/i })[TOTAL_BUTTON_INDEX]!,
    );
    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ sort: expect.anything() }),
      );
    });
  });

  it('does not make the customer or item-count columns sortable', async () => {
    // Neither is a real column on Order — customer is a relation, item count
    // is a Prisma _count — and buildOrderBy in orders.service.ts can't sort
    // by either. A sort button here would fire a request whose sort param
    // gets silently dropped, which reads as a dead click.
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    // Exactly 4 sortable columns (orderNumber, placedAt, total, status) —
    // if customer or items ever gained a sortValue, this count would catch it.
    expect(screen.getAllByRole('button', { name: /sort ascending/i })).toHaveLength(4);
  });

  it('degrades a hand-edited unsortable sort field to no sort', async () => {
    resolveWith([makeOrder()]);
    urlState.write('/admin/orders?sort=customer');

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    expect(fetchOrders).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ sort: expect.anything() }),
    );
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

describe('saved view tabs', () => {
  it('marks All as active with no status filter applied', async () => {
    resolveWith([makeOrder()]);
    render(<OrdersTable />);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'All statuses' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('clicking a tab writes the same status filter the dropdown would', async () => {
    resolveWith([makeOrder()]);
    render(<OrdersTable />);
    await screen.findByRole('tab', { name: 'All statuses' });

    await userEvent.click(screen.getByRole('tab', { name: 'Shipped' }));

    await waitFor(() =>
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'SHIPPED' }),
      ),
    );
    expect(screen.getByRole('tab', { name: 'Shipped' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reflects a status set via the dropdown as the matching tab going active', async () => {
    resolveWith([makeOrder()]);
    render(<OrdersTable />);
    await screen.findByRole('tab', { name: 'All statuses' });

    await userEvent.click(screen.getByRole('combobox', { name: /status/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'Delivered' }));

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Delivered' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });
});

describe('bulk status change', () => {
  it('offers no bulk action until a row is selected', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    expect(screen.queryByLabelText('Move to')).not.toBeInTheDocument();
  });

  it('sends the selected ids and target status, and reports the outcome', async () => {
    bulkChangeOrderStatus.mockResolvedValue({ succeeded: ['o1'], skipped: [] });
    resolveWith([makeOrder({ id: 'o1' })]);

    render(
      <>
        <OrdersTable />
        <Toaster />
      </>,
    );
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    // Confirmation dialog — a bulk write is not one click.
    await userEvent.click(await screen.findByRole('button', { name: 'Move' }));

    await waitFor(() => {
      expect(bulkChangeOrderStatus).toHaveBeenCalledWith(['o1'], 'CONFIRMED');
    });
    expect(await screen.findByText(/1 order moved to Confirmed/i)).toBeInTheDocument();
  });

  it('surfaces skipped orders honestly rather than implying every order moved', async () => {
    // A selection spanning several current statuses is the NORMAL case for
    // this action, not an edge case — some orders being skipped is expected,
    // and the toast has to say so rather than reporting a clean success.
    bulkChangeOrderStatus.mockResolvedValue({
      succeeded: ['o1'],
      skipped: [{ id: 'o2', reason: 'Cannot move an order from DELIVERED to CONFIRMED' }],
    });
    resolveWith([
      makeOrder({ id: 'o1', orderNumber: 'ORD-1' }),
      makeOrder({ id: 'o2', orderNumber: 'ORD-2', status: 'DELIVERED' }),
    ]);

    render(
      <>
        <OrdersTable />
        <Toaster />
      </>,
    );
    await screen.findByText('ORD-1');

    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move' }));

    expect(await screen.findByText(/1 order moved to Confirmed/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/1 order was skipped.*Cannot move an order/i),
    ).toBeInTheDocument();
  });

  it('reloads the list and clears the selection after applying', async () => {
    bulkChangeOrderStatus.mockResolvedValue({ succeeded: ['o1'], skipped: [] });
    resolveWith([makeOrder({ id: 'o1' })]);

    render(
      <>
        <OrdersTable />
        <Toaster />
      </>,
    );
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move' }));

    await waitFor(() => expect(fetchOrders).toHaveBeenCalledTimes(2));
    // The bulk bar (only rendered while something is selected) is gone —
    // selection was cleared, not left pointing at rows from before the
    // reload.
    expect(screen.queryByLabelText('Move to')).not.toBeInTheDocument();
  });

  it('names the target status and the skip caveat in the confirmation dialog before anything is sent', async () => {
    resolveWith([makeOrder({ id: 'o1' })]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText(/Move this order\?/i)).toBeInTheDocument();
    expect(screen.getByText(/moved to Confirmed/i)).toBeInTheDocument();
    expect(bulkChangeOrderStatus).not.toHaveBeenCalled();
  });
});

describe('bulk status change — real dependency info (C5.5)', () => {
  it('names how many of the selection have a live courier assignment', async () => {
    previewBulkStatusChange.mockResolvedValue({
      eligibleCount: 2,
      ineligibleCount: 0,
      withActiveAssignment: 2,
      isTerminal: false,
    });
    resolveWith([
      makeOrder({ id: 'o1', orderNumber: 'ORD-1', status: 'SHIPPED' }),
      makeOrder({ id: 'o2', orderNumber: 'ORD-2', status: 'SHIPPED' }),
    ]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1');

    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Delivered' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(
      await screen.findByText(/2 of these have an active courier assignment/i),
    ).toBeInTheDocument();
  });

  it('says nothing about assignments when none of the selection has one', async () => {
    resolveWith([makeOrder({ id: 'o1' })]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await screen.findByText(/Move this order\?/i);
    expect(screen.queryByText(/active courier assignment/i)).not.toBeInTheDocument();
  });

  it('keeps Move disabled until the dependency preview resolves', async () => {
    let resolvePreview: (value: unknown) => void = () => {};
    previewBulkStatusChange.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    resolveWith([makeOrder({ id: 'o1' })]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const moveButton = await screen.findByRole('button', { name: 'Move' });
    expect(moveButton).toBeDisabled();

    resolvePreview({ eligibleCount: 1, ineligibleCount: 0, withActiveAssignment: 0, isTerminal: false });

    await waitFor(() => expect(moveButton).toBeEnabled());
  });

  it('does not block confirmation forever if the preview lookup fails', async () => {
    previewBulkStatusChange.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));
    bulkChangeOrderStatus.mockResolvedValue({ succeeded: ['o1'], skipped: [] });
    resolveWith([makeOrder({ id: 'o1' })]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled());
  });
});

describe('bulk status change — terminal targets require typed confirmation (C5.5)', () => {
  it('requires typing the exact status before Move enables, for a terminal target', async () => {
    previewBulkStatusChange.mockResolvedValue({
      eligibleCount: 1,
      ineligibleCount: 0,
      withActiveAssignment: 0,
      isTerminal: true,
    });
    resolveWith([makeOrder({ id: 'o1' })]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Canceled' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const moveButton = await screen.findByRole('button', { name: 'Move' });
    await waitFor(() => expect(moveButton).toBeDisabled());

    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/type canceled/i), 'wrong');
    expect(moveButton).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/type canceled/i));
    await userEvent.type(screen.getByLabelText(/type canceled/i), 'CANCELED');
    expect(moveButton).toBeEnabled();
  });

  it('does not require typing for a non-terminal target', async () => {
    resolveWith([makeOrder({ id: 'o1' })]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));
    await userEvent.click(screen.getByLabelText('Move to'));
    await userEvent.click(await screen.findByRole('option', { name: 'Confirmed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.queryByLabelText(/type confirmed/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled());
  });
});

describe('CSV export', () => {
  it('exports the active filter, not just the rows on screen', async () => {
    resolveWith([makeOrder()]);
    urlState.write('/admin/orders?status=SHIPPED&search=ali');

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(exportOrdersCsv).toHaveBeenCalled());
    // A manager asking for "every shipped order" means all of them, not the
    // one row currently on screen — page/pageSize must never reach the call.
    expect(exportOrdersCsv).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SHIPPED', search: 'ali' }),
    );
    expect(exportOrdersCsv.mock.calls[0]?.[0]).not.toHaveProperty('page');
    expect(exportOrdersCsv.mock.calls[0]?.[0]).not.toHaveProperty('pageSize');
  });

  it('sends the current sort along with the export', async () => {
    resolveWith([makeOrder()]);

    render(<OrdersTable />);
    await screen.findByText('ORD-1024');

    await userEvent.click(
      screen.getAllByRole('button', { name: /sort ascending/i })[2]!, // total
    );
    await waitFor(() => {
      expect(fetchOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'total' }),
      );
    });

    await userEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => {
      expect(exportOrdersCsv).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'total', dir: 'asc' }),
      );
    });
  });

  it('disables the export button while the list is empty', async () => {
    resolveWith([]);

    render(<OrdersTable />);
    await waitFor(() => expect(fetchOrders).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('surfaces a failed export as a toast rather than a silent no-op', async () => {
    resolveWith([makeOrder()]);
    // useTranslatedApiError maps a 500 to a generic "server had a problem"
    // message, never the raw error text — asserting on THAT translated
    // string, not an arbitrary message this mock happens to carry.
    exportOrdersCsv.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', undefined));

    render(
      <>
        <OrdersTable />
        <Toaster />
      </>,
    );
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });
});
