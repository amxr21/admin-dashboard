import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { ApiError } from '@/lib/api';
import { BreadcrumbProvider, useBreadcrumbSegments } from '@/components/shell/breadcrumb';
import { OrderDetail } from '../order-detail';
import type { OrderDetail as Order } from '@/lib/orders-api';

// next-intl's navigation module resolves `next/navigation` in a way Vitest
// cannot follow. Same stub the error-screen tests use. `href` may be an
// object ({ pathname, query }, as C5.1's Prev/Next links use) or a plain
// string — both are rendered as-is so a test can assert on either shape.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement(
      'a',
      {
        href: typeof href === 'string' ? href : JSON.stringify(href),
        ...props,
      },
      children as ReactNode,
    ),
}));

/**
 * `next/navigation`'s global stub (vitest.setup.ts) always returns an empty
 * `URLSearchParams` — correct for every OTHER test here (no list context, no
 * Prev/Next), but C5.1's own tests need to simulate arriving via a filtered
 * orders-table row link, so this local mock makes the query string settable.
 */
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
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
const fetchOrderNeighbors = vi.hoisted(() => vi.fn());
const fetchOrderTimeline = vi.hoisted(() => vi.fn());
const changeOrderStatus = vi.hoisted(() => vi.fn());
const addOrderNote = vi.hoisted(() => vi.fn());
const createReturn = vi.hoisted(() => vi.fn());
const fetchCouriers = vi.hoisted(() => vi.fn());
const assignCourier = vi.hoisted(() => vi.fn());
const unassignCourier = vi.hoisted(() => vi.fn());
const updateAssignment = vi.hoisted(() => vi.fn());
const fetchAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/orders-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders-api')>();
  return {
    ...actual,
    fetchOrder,
    fetchOrderNeighbors,
    fetchOrderTimeline,
    changeOrderStatus,
    addOrderNote,
  };
});

vi.mock('@/lib/audit-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit-api')>();
  return { ...actual, fetchAudit };
});

vi.mock('@/lib/returns-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/returns-api')>();
  return { ...actual, createReturn };
});

vi.mock('@/lib/delivery-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/delivery-api')>();
  return { ...actual, fetchCouriers, assignCourier, unassignCourier, updateAssignment };
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
    statusHistory: [
      {
        id: 'h1',
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        note: 'payment cleared',
        changedById: 'u1',
        changedByName: 'Owner Person',
        createdAt: '2026-07-01T11:00:00.000Z',
      },
    ],
    assignment: null,
    nextStatuses: ['SHIPPED', 'CANCELED'],
    ...overrides,
  };
}

const COURIERS = [
  {
    id: 'd1',
    name: 'Sami',
    email: null,
    phone: '+971500000001',
    vehicleType: null,
    plateNumber: null,
    zone: null,
    region: null,
    country: null,
    status: 'ACTIVE' as const,
    createdAt: '2026-07-01T00:00:00.000Z',
    hasAccessCode: true,
    activeAssignments: 0,
  },
  {
    id: 'd2',
    name: 'Retired Courier',
    email: null,
    phone: null,
    vehicleType: null,
    plateNumber: null,
    zone: null,
    region: null,
    country: null,
    status: 'INACTIVE' as const,
    createdAt: '2026-07-01T00:00:00.000Z',
    hasAccessCode: false,
    activeAssignments: 0,
  },
];

beforeEach(() => {
  searchParams = new URLSearchParams();
  fetchOrder.mockReset();
  fetchOrderNeighbors.mockReset();
  fetchOrderTimeline.mockReset();
  changeOrderStatus.mockReset();
  addOrderNote.mockReset();
  createReturn.mockReset();
  fetchCouriers.mockReset();
  assignCourier.mockReset();
  unassignCourier.mockReset();
  updateAssignment.mockReset();
  fetchAudit.mockReset();
  fetchCouriers.mockResolvedValue({
    couriers: COURIERS,
    total: COURIERS.length,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  });
  fetchAudit.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 1, totalPages: 0, nextCursor: null });
  fetchOrderTimeline.mockResolvedValue([]);
});

describe('breadcrumb (C4.4)', () => {
  it('registers Orders → order number with the shell', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    function Consumer() {
      const segments = useBreadcrumbSegments();
      return <div data-testid="crumbs">{segments ? JSON.stringify(segments) : 'none'}</div>;
    }

    render(
      <BreadcrumbProvider>
        <OrderDetail id="o1" />
        <Consumer />
      </BreadcrumbProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('crumbs').textContent).toContain('/admin/orders');
    });
    expect(screen.getByTestId('crumbs').textContent).toContain('ORD-1024');
  });
});

describe('prev/next within the filtered list (C5.1)', () => {
  it('renders nothing when there is no list context (a bookmark or deep link, not a table row click)', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderDetail id="o1" />);

    await screen.findByText('Ceramic Planter');
    expect(fetchOrderNeighbors).not.toHaveBeenCalled();
    expect(screen.queryByText('ORD-1000')).not.toBeInTheDocument();
  });

  it('fetches neighbors using the filters carried on the URL, and links to both', async () => {
    searchParams = new URLSearchParams({ status: 'CONFIRMED', search: 'ali' });
    fetchOrder.mockResolvedValue(makeOrder());
    fetchOrderNeighbors.mockResolvedValue({
      prev: { id: 'o0', orderNumber: 'ORD-1000' },
      next: { id: 'o2', orderNumber: 'ORD-1099' },
    });

    render(<OrderDetail id="o1" />);

    await waitFor(() => {
      expect(fetchOrderNeighbors).toHaveBeenCalledWith('o1', {
        status: 'CONFIRMED',
        search: 'ali',
      });
    });

    const prevLink = await screen.findByRole('link', { name: /ORD-1000/ });
    expect(prevLink.getAttribute('href')).toContain('"pathname":"/admin/orders/o0"');
    expect(prevLink.getAttribute('href')).toContain('"status":"CONFIRMED"');

    const nextLink = screen.getByRole('link', { name: /ORD-1099/ });
    expect(nextLink.getAttribute('href')).toContain('"pathname":"/admin/orders/o2"');
  });

  it('shows only the side that has a neighbor at the edge of the list', async () => {
    searchParams = new URLSearchParams({ status: 'CONFIRMED' });
    fetchOrder.mockResolvedValue(makeOrder());
    fetchOrderNeighbors.mockResolvedValue({ prev: null, next: { id: 'o2', orderNumber: 'ORD-1099' } });

    render(<OrderDetail id="o1" />);

    expect(await screen.findByRole('link', { name: /ORD-1099/ })).toBeInTheDocument();
    expect(screen.queryByText('ORD-1000')).not.toBeInTheDocument();
  });

  it('does not block the order from rendering when the neighbor lookup fails', async () => {
    searchParams = new URLSearchParams({ status: 'CONFIRMED' });
    fetchOrder.mockResolvedValue(makeOrder());
    fetchOrderNeighbors.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText('Ceramic Planter')).toBeInTheDocument();
  });
});

describe('"Updated by" (C5.3)', () => {
  it('shows the latest status-history entry when there is no audit entry', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText(/Owner Person/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Owner Person/ });
    expect(link).toHaveAttribute('href', '/admin/audit?entity=orders&entityId=o1');
  });

  it('prefers the newer of the two signals — a later delivery-status audit entry over an earlier status move', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        statusHistory: [
          {
            id: 'h1',
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            note: null,
            changedById: 'u1',
            changedByName: 'Owner Person',
            createdAt: '2026-07-01T10:00:00.000Z',
          },
        ],
      }),
    );
    fetchAudit.mockResolvedValue({
      entries: [
        {
          id: 'a1',
          action: 'delivery.assignment.status_changed',
          entity: 'orders',
          entityId: 'o1',
          actorId: null,
          actorEmail: 'support@example.test',
          actorRole: null,
          changes: { deliveryStatus: { from: 'ASSIGNED', to: 'PICKED_UP' } },
          outcome: 'SUCCESS',
          requestId: null,
          ip: null,
          userAgent: null,
          createdAt: '2026-07-02T10:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 1,
      totalPages: 1,
      nextCursor: null,
    });

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText(/support@example\.test/)).toBeInTheDocument();
    expect(screen.queryByText(/Owner Person/)).not.toBeInTheDocument();
  });

  it('renders nothing when the order has never been touched beyond creation', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ statusHistory: [] }));

    render(<OrderDetail id="o1" />);

    await screen.findByText('Ceramic Planter');
    expect(screen.queryByRole('link', { name: /admin\/audit/i })).not.toBeInTheDocument();
  });

  it('does not block the order from rendering when the audit lookup fails', async () => {
    fetchOrder.mockResolvedValue(makeOrder());
    fetchAudit.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText('Ceramic Planter')).toBeInTheDocument();
    // Falls back to the status-history entry alone.
    expect(await screen.findByText(/Owner Person/)).toBeInTheDocument();
  });
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

  it('renders the merged timeline (C5.4)', async () => {
    fetchOrder.mockResolvedValue(makeOrder());
    fetchOrderTimeline.mockResolvedValue([
      {
        id: 'status-h1',
        kind: 'status',
        action: 'order.status.changed',
        actorName: 'Owner Person',
        createdAt: '2026-07-01T11:00:00.000Z',
        detail: { fromStatus: 'PENDING', toStatus: 'CONFIRMED', note: 'payment cleared' },
      },
    ]);

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
    // Specifically the status-change note: the delivery section has its own
    // "Note for the courier" field, so a bare /note/i now matches both.
    await userEvent.type(screen.getByLabelText(/note \(optional\)/i), 'left the warehouse');
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
      category: null,
      status: 'REQUESTED',
      resolution: 'NONE',
      refundAmount: null,
      restocked: false,
      rejectionReason: null,
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

  it('submits without a category — it is optional alongside the free-text reason', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({ status: 'DELIVERED', nextStatuses: ['RETURNED'] }),
    );
    createReturn.mockResolvedValue({
      id: 'r1',
      rmaNumber: 'RMA-ABCD1234',
      reason: 'damaged',
      category: null,
      status: 'REQUESTED',
      resolution: 'NONE',
      refundAmount: null,
      restocked: false,
      rejectionReason: null,
      createdAt: '2026-07-02T00:00:00.000Z',
      order: { id: 'o1', orderNumber: 'ORD-1024', status: 'DELIVERED' },
      customer: null,
      items: [],
    });

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: /request return/i }));
    const dialog = await screen.findByRole('dialog');

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
  });

  it('includes the chosen category when one is selected', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({ status: 'DELIVERED', nextStatuses: ['RETURNED'] }),
    );
    createReturn.mockResolvedValue({
      id: 'r1',
      rmaNumber: 'RMA-ABCD1234',
      reason: 'damaged',
      category: 'DAMAGED',
      status: 'REQUESTED',
      resolution: 'NONE',
      refundAmount: null,
      restocked: false,
      rejectionReason: null,
      createdAt: '2026-07-02T00:00:00.000Z',
      order: { id: 'o1', orderNumber: 'ORD-1024', status: 'DELIVERED' },
      customer: null,
      items: [],
    });

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: /request return/i }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.type(within(dialog).getByLabelText(/reason/i), 'arrived damaged');
    await userEvent.click(within(dialog).getByLabelText(/category/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Damaged' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /request return/i }));

    await waitFor(() => {
      expect(createReturn).toHaveBeenCalledWith({
        orderId: 'o1',
        reason: 'arrived damaged',
        category: 'DAMAGED',
        items: [{ orderItemId: 'i1', quantity: 2 }],
      });
    });
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

describe('order notes thread (C5.7)', () => {
  it('shows an empty state when nothing has been noted yet', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ notes: [] }));

    render(<OrderDetail id="o1" />);

    await screen.findByText('Ceramic Planter');
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('lists every note with its author, oldest first, without erasing earlier ones', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        notes: [
          {
            id: 'n1',
            body: 'called twice, no answer',
            authorId: 'u1',
            authorName: 'Owner Person',
            createdAt: '2026-07-01T09:00:00.000Z',
          },
          {
            id: 'n2',
            body: 'left voicemail',
            authorId: 'u2',
            authorName: 'Support Person',
            createdAt: '2026-07-02T09:00:00.000Z',
          },
        ],
      }),
    );

    render(<OrderDetail id="o1" />);

    expect(await screen.findByText('called twice, no answer')).toBeInTheDocument();
    expect(screen.getByText('left voicemail')).toBeInTheDocument();
    // "Owner Person" also appears in the "Updated by" note above (C5.3) —
    // this only asserts the notes thread itself carries an author.
    expect(screen.getAllByText(/Owner Person/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Support Person/)).toBeInTheDocument();
  });

  it('disables Add until something is typed', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ notes: [] }));

    render(<OrderDetail id="o1" />);

    const textarea = await screen.findByPlaceholderText(/staff-only/i);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await userEvent.type(textarea, 'called twice, no answer');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('adds a note and clears the draft, without touching notes already there', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        notes: [
          {
            id: 'n1',
            body: 'existing note',
            authorId: 'u1',
            authorName: 'Owner Person',
            createdAt: '2026-07-01T09:00:00.000Z',
          },
        ],
      }),
    );
    addOrderNote.mockResolvedValue(
      makeOrder({
        notes: [
          {
            id: 'n1',
            body: 'existing note',
            authorId: 'u1',
            authorName: 'Owner Person',
            createdAt: '2026-07-01T09:00:00.000Z',
          },
          {
            id: 'n2',
            body: 'called twice, no answer',
            authorId: 'u1',
            authorName: 'Owner Person',
            createdAt: '2026-07-02T09:00:00.000Z',
          },
        ],
      }),
    );

    render(<OrderDetail id="o1" />);

    const textarea = await screen.findByPlaceholderText(/staff-only/i);
    await userEvent.type(textarea, 'called twice, no answer');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(addOrderNote).toHaveBeenCalledWith('o1', 'called twice, no answer');
    });
    expect(await screen.findByText('called twice, no answer')).toBeInTheDocument();
    // The earlier note is still there, not overwritten.
    expect(screen.getByText('existing note')).toBeInTheDocument();
    expect(textarea).toHaveValue('');
  });

  it('surfaces a failed add instead of losing the draft silently', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ notes: [] }));
    addOrderNote.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<OrderDetail id="o1" />);

    const textarea = await screen.findByPlaceholderText(/staff-only/i);
    await userEvent.type(textarea, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // The typed text is not thrown away on a failed save.
    expect(textarea).toHaveValue('x');
  });
});

describe('assigning a courier', () => {
  it('assigns an unassigned order to the chosen courier', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ assignment: null }));
    assignCourier.mockResolvedValue({
      id: 'a1',
      status: 'ASSIGNED',
      address: null,
      city: null,
      attemptCount: 0,
      failureReason: null,
      driver: { id: 'd1', name: 'Sami', phone: '+971500000001' },
    });

    render(<OrderDetail id="o1" />);

    await screen.findByText(/no courier assigned yet/i);

    // Only the active courier is offered — the inactive one is filtered out.
    await userEvent.click(screen.getByLabelText('Courier'));
    expect(await screen.findByRole('option', { name: 'Sami' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Retired Courier' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'Sami' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      expect(assignCourier).toHaveBeenCalledWith({ orderId: 'o1', driverId: 'd1' });
    });
    expect(await screen.findByRole('button', { name: 'Reassign' })).toBeInTheDocument();
  });

  it('reassigns an already-assigned order', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        assignment: {
          id: 'a1',
          status: 'ASSIGNED',
          address: null,
          city: null,
          attemptCount: 0,
          failureReason: null,
          driver: { id: 'd0', name: 'Original Driver', phone: null },
        },
      }),
    );
    assignCourier.mockResolvedValue({
      id: 'a1',
      status: 'ASSIGNED',
      address: null,
      city: null,
      attemptCount: 0,
      failureReason: null,
      driver: { id: 'd1', name: 'Sami', phone: '+971500000001' },
    });

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reassign' }));
    await userEvent.click(screen.getByLabelText('Courier'));
    await userEvent.click(await screen.findByRole('option', { name: 'Sami' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      expect(assignCourier).toHaveBeenCalledWith({ orderId: 'o1', driverId: 'd1' });
    });
  });

  it('unassigns a courier and returns to the unassigned state', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        assignment: {
          id: 'a1',
          status: 'ASSIGNED',
          address: null,
          city: null,
          attemptCount: 0,
          failureReason: null,
          driver: { id: 'd0', name: 'Original Driver', phone: null },
        },
      }),
    );
    unassignCourier.mockResolvedValue(undefined);

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Unassign' }));

    await waitFor(() => {
      expect(unassignCourier).toHaveBeenCalledWith('a1');
    });
    expect(await screen.findByText(/no courier assigned yet/i)).toBeInTheDocument();
  });

  it('disables Unassign once the delivery is already complete', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        assignment: {
          id: 'a1',
          status: 'DELIVERED',
          address: null,
          city: null,
          attemptCount: 0,
          failureReason: null,
          driver: { id: 'd0', name: 'Original Driver', phone: null },
        },
      }),
    );

    render(<OrderDetail id="o1" />);

    expect(await screen.findByRole('button', { name: 'Unassign' })).toBeDisabled();
  });

  it('corrects the address without reassigning (B4.1)', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        assignment: {
          id: 'a1',
          status: 'PICKED_UP',
          address: 'Original St',
          city: 'Dubai',
          attemptCount: 0,
          failureReason: null,
          driver: { id: 'd0', name: 'Original Driver', phone: null },
        },
      }),
    );
    updateAssignment.mockResolvedValue({
      id: 'a1',
      status: 'PICKED_UP',
      address: 'Corrected St',
      city: 'Dubai',
      attemptCount: 0,
      failureReason: null,
      driver: { id: 'd0', name: 'Original Driver', phone: null },
    });

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit address' }));
    const addressInput = screen.getByLabelText('Delivery address');
    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, 'Corrected St');
    await userEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => {
      expect(updateAssignment).toHaveBeenCalledWith('a1', {
        address: 'Corrected St',
        city: 'Dubai',
      });
    });
    // Reassigning was never called — the courier/status must be untouched.
    expect(assignCourier).not.toHaveBeenCalled();
  });

  it('does not offer address editing on a completed delivery', async () => {
    fetchOrder.mockResolvedValue(
      makeOrder({
        assignment: {
          id: 'a1',
          status: 'DELIVERED',
          address: 'Some St',
          city: 'Dubai',
          attemptCount: 0,
          failureReason: null,
          driver: { id: 'd0', name: 'Original Driver', phone: null },
        },
      }),
    );

    render(<OrderDetail id="o1" />);

    expect(await screen.findByRole('button', { name: 'Edit address' })).toBeDisabled();
  });

  it('renders no assignment control at all on a terminal order', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ status: 'CANCELED', nextStatuses: [] }));

    render(<OrderDetail id="o1" />);

    await screen.findByText(/no courier assigned yet/i);
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });

  it('surfaces a refused assignment instead of failing silently', async () => {
    fetchOrder.mockResolvedValue(makeOrder({ assignment: null }));
    assignCourier.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'That courier is inactive'),
    );

    render(<OrderDetail id="o1" />);

    await userEvent.click(await screen.findByLabelText('Courier'));
    await userEvent.click(await screen.findByRole('option', { name: 'Sami' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    fetchOrder.mockResolvedValue(makeOrder());

    render(<OrderDetail id="o1" />, { locale: 'ar' });

    expect(await screen.findByText('العميل')).toBeInTheDocument();
  });
});
