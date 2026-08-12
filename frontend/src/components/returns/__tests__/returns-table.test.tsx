import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/sonner';
import { ReturnsTable } from '../returns-table';
import type { ReturnDetail, ReturnListRow } from '@/lib/returns-api';

/**
 * The returns queue and its detail sheet.
 *
 * The property worth pinning: a return that is still REQUESTED offers
 * approve/reject, and approving REQUIRES a resolution and — for a refund — an
 * amount the server would actually accept. A return already decided renders
 * read-only, never a form that could re-fire the same action twice.
 */

// Completes the module surface — the table's filters live in the URL, so it
// calls `useRouter`/`usePathname` too. Inert stubs are enough here: nothing in
// this file asserts on filtering, so the navigation never needs to round-trip.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/admin/returns',
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

// ReturnDetailSheet reads the actor's role to decide whether to show the
// "view history" link to the audit trail — a rendering hint only (see
// useAuth.tsx), so a fixed OWNER stand-in is fine for every test here.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'owner@example.test', name: 'Owner', role: 'OWNER' },
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const fetchReturns = vi.hoisted(() => vi.fn());
const fetchReturn = vi.hoisted(() => vi.fn());
const approveReturn = vi.hoisted(() => vi.fn());
const rejectReturn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/returns-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/returns-api')>();
  return { ...actual, fetchReturns, fetchReturn, approveReturn, rejectReturn };
});

function makeRow(overrides: Partial<ReturnListRow> = {}): ReturnListRow {
  return {
    id: 'r1',
    rmaNumber: 'RMA-ABCD1234',
    status: 'REQUESTED',
    resolution: 'NONE',
    category: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    order: { id: 'o1', orderNumber: 'ORD-1024' },
    customer: { id: 'c1', name: 'Ali' },
    itemCount: 1,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<ReturnDetail> = {}): ReturnDetail {
  return {
    id: 'r1',
    rmaNumber: 'RMA-ABCD1234',
    reason: 'Arrived damaged',
    category: null,
    status: 'REQUESTED',
    resolution: 'NONE',
    refundAmount: null,
    restocked: false,
    rejectionReason: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    order: { id: 'o1', orderNumber: 'ORD-1024', status: 'DELIVERED' },
    customer: { id: 'c1', name: 'Ali', email: 'ali@example.com' },
    items: [
      {
        id: 'ri1',
        quantity: 2,
        orderItemId: 'i1',
        price: '25.00',
        lineTotal: '50.00',
        product: { id: 'p1', name: 'Ceramic Planter', sku: 'SKU-1' },
      },
    ],
    ...overrides,
  };
}

function resolveList(rows: ReturnListRow[]) {
  fetchReturns.mockResolvedValue({
    returns: rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
}

beforeEach(() => {
  fetchReturns.mockReset();
  fetchReturn.mockReset();
  approveReturn.mockReset();
  rejectReturn.mockReset();
});

describe('the queue', () => {
  it('lists returns with their status', async () => {
    resolveList([makeRow()]);

    render(<ReturnsTable />);

    expect(await screen.findByText('RMA-ABCD1234')).toBeInTheDocument();
    expect(screen.getByText('ORD-1024')).toBeInTheDocument();

    // "Requested" is also a column header (when it was requested), so scope
    // to the row rather than the whole page.
    const row = screen.getByText('RMA-ABCD1234').closest('tr');
    expect(within(row as HTMLElement).getByText('Requested')).toBeInTheDocument();
  });
});

describe('approving', () => {
  it('opens the detail sheet and requires a resolution before approving', async () => {
    resolveList([makeRow()]);
    fetchReturn.mockResolvedValue(makeDetail());
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    // No resolution chosen yet — approving must be disabled.
    expect(within(dialog).getByRole('button', { name: /^approve$/i })).toBeDisabled();
  });

  it('requires a refund amount within the cap when the resolution is REFUND', async () => {
    resolveList([makeRow()]);
    fetchReturn.mockResolvedValue(makeDetail());
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    await user.click(within(dialog).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Refund' }));

    // The 50.00 line total is the ceiling shown to the user (it also appears
    // once already, as the item's own line total).
    expect(within(dialog).getAllByText(/50\.00/).length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByRole('button', { name: /^approve$/i })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/refund amount/i), '50');

    expect(within(dialog).getByRole('button', { name: /^approve$/i })).not.toBeDisabled();
  });

  it('approves with store credit and restocking, and refreshes the list', async () => {
    resolveList([makeRow()]);
    fetchReturn.mockResolvedValue(makeDetail());
    approveReturn.mockResolvedValue(makeDetail({ status: 'APPROVED', resolution: 'STORE_CREDIT' }));
    const user = userEvent.setup();

    render(
      <>
        <ReturnsTable />
        <Toaster />
      </>,
    );
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    await user.click(within(dialog).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Store credit' }));
    await user.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(approveReturn).toHaveBeenCalledWith('r1', {
        resolution: 'STORE_CREDIT',
        restock: true,
      });
    });

    expect(await screen.findByText(/RMA-ABCD1234 approved/)).toBeInTheDocument();
  });

  it('surfaces a refused approval rather than failing silently', async () => {
    resolveList([makeRow()]);
    fetchReturn.mockResolvedValue(makeDetail());
    approveReturn.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'This return is already approved'),
    );
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    await user.click(within(dialog).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Replacement' }));
    await user.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already approved/i);
  });
});

describe('rejecting', () => {
  it('rejects without requiring a resolution, but does require a reason', async () => {
    resolveList([makeRow()]);
    fetchReturn.mockResolvedValue(makeDetail());
    rejectReturn.mockResolvedValue(makeDetail({ status: 'REJECTED' }));
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    // Clicking Reject reveals a required reason field rather than firing
    // immediately — it used to take no input at all.
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    const confirmButton = within(dialog).getByRole('button', { name: /confirm rejection/i });
    expect(confirmButton).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/why is this being rejected/i),
      'Outside the return window',
    );
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => {
      expect(rejectReturn).toHaveBeenCalledWith('r1', 'Outside the return window');
    });
  });

  it('cancelling the reason field returns to the approve/reject choice', async () => {
    resolveList([makeRow()]);
    fetchReturn.mockResolvedValue(makeDetail());
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }));
    expect(within(dialog).getByLabelText(/why is this being rejected/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));

    expect(within(dialog).getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/why is this being rejected/i)).not.toBeInTheDocument();
    expect(rejectReturn).not.toHaveBeenCalled();
  });
});

describe('an already-decided return', () => {
  it('renders read-only, with no approve/reject controls', async () => {
    resolveList([makeRow({ status: 'APPROVED', resolution: 'REFUND' })]);
    fetchReturn.mockResolvedValue(
      makeDetail({ status: 'APPROVED', resolution: 'REFUND', refundAmount: '50.00' }),
    );
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    expect(within(dialog).getAllByText(/50\.00/).length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('shows the rejection reason instead of a resolution on a REJECTED return', async () => {
    resolveList([makeRow({ status: 'REJECTED' })]);
    fetchReturn.mockResolvedValue(
      makeDetail({ status: 'REJECTED', rejectionReason: 'Outside the return window' }),
    );
    const user = userEvent.setup();

    render(<ReturnsTable />);
    await user.click(await screen.findByText('RMA-ABCD1234'));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Arrived damaged');

    expect(within(dialog).getByText('Outside the return window')).toBeInTheDocument();
    // A rejected return never had a resolution decided — that block must not
    // render alongside the rejection reason.
    expect(within(dialog).queryByText('Resolution')).not.toBeInTheDocument();
  });
});
