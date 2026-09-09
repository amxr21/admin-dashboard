import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { TillReturnSheet } from '../till-return-sheet';

/**
 * Return at the register (O9.7).
 *
 * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
 * The 403-on-approve → override dialog flow is the actual security-relevant
 * path: approving is refused server-side for a cashier with no override
 * (verified in returns.test.ts), and this component's job is to recognise
 * that specific refusal and offer the fix, not just show a generic error.
 */

const {
  fetchOrders,
  fetchOrder,
  createReturn,
  approveReturn,
  requestManagerOverride,
} = vi.hoisted(() => ({
  fetchOrders: vi.fn(),
  fetchOrder: vi.fn(),
  createReturn: vi.fn(),
  approveReturn: vi.fn(),
  requestManagerOverride: vi.fn(),
}));

vi.mock('@/lib/orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orders-api')>()),
  fetchOrders,
  fetchOrder,
}));

vi.mock('@/lib/returns-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/returns-api')>()),
  createReturn,
  approveReturn,
}));

vi.mock('@/lib/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-api')>()),
  requestManagerOverride,
}));

const ORDER_ROW = {
  id: 'o1',
  orderNumber: 'POS-1',
  status: 'DELIVERED' as const,
  total: '25.00',
  placedAt: new Date().toISOString(),
  paymentMethod: 'cash',
  customer: null,
  branch: null,
  itemCount: 1,
};

const ORDER_DETAIL = {
  id: 'o1',
  orderNumber: 'POS-1',
  status: 'DELIVERED' as const,
  branch: null,
  total: '25.00',
  subtotal: '25.00',
  taxAmount: '0.00',
  paymentMethod: 'cash',
  placedAt: new Date().toISOString(),
  notes: [],
  customer: null,
  items: [
    {
      id: 'oi1',
      quantity: 1,
      price: '25.00',
      lineTotal: '25.00',
      productId: 'p1',
      product: { id: 'p1', name: 'Flat white', sku: 'FW-1', imageUrl: null },
    },
  ],
  statusHistory: [],
  assignment: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchOrders.mockResolvedValue({ orders: [ORDER_ROW], total: 1, page: 1, pageSize: 5, totalPages: 1 });
  fetchOrder.mockResolvedValue(ORDER_DETAIL);
});

async function lookUpAndSelectLine() {
  await userEvent.type(screen.getByLabelText(/order number/i), 'POS-1');
  await userEvent.click(screen.getByRole('button', { name: /look up/i }));

  await screen.findByText(/order pos-1/i);
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: /continue/i }));

  await screen.findByLabelText(/reason/i);
  await userEvent.type(screen.getByLabelText(/refund amount/i), '25.00');
}

describe('the till return sheet', () => {
  it('looks up an order and shows its lines', async () => {
    render(<TillReturnSheet open onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText(/order number/i), 'POS-1');
    await userEvent.click(screen.getByRole('button', { name: /look up/i }));

    expect(await screen.findByText('Flat white')).toBeInTheDocument();
  });

  it('processes a return directly when no override is needed', async () => {
    createReturn.mockResolvedValue({ id: 'r1' });
    approveReturn.mockResolvedValue({ id: 'r1' });

    render(<TillReturnSheet open onOpenChange={() => undefined} />);
    await lookUpAndSelectLine();

    await userEvent.click(screen.getByRole('button', { name: /process return/i }));

    await waitFor(() => {
      expect(approveReturn).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ resolution: 'REFUND' }),
      );
    });
    expect(requestManagerOverride).not.toHaveBeenCalled();
  });

  it('opens the manager override dialog when approval is refused, then retries with the token', async () => {
    createReturn.mockResolvedValue({ id: 'r1' });
    approveReturn
      .mockRejectedValueOnce(
        new ApiError(403, 'FORBIDDEN', 'A manager needs to approve this in place'),
      )
      .mockResolvedValueOnce({ id: 'r1' });
    requestManagerOverride.mockResolvedValue({
      approverId: 'm1',
      approverName: 'Sara',
      overrideToken: 'signed-token',
    });

    render(<TillReturnSheet open onOpenChange={() => undefined} />);
    await lookUpAndSelectLine();

    await userEvent.click(screen.getByRole('button', { name: /process return/i }));

    expect(await screen.findByText(/manager approval needed/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/manager email/i), 'sara@example.test');
    await userEvent.type(screen.getByLabelText(/manager password/i), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      // The request is NOT recreated on retry — the same return id from the
      // first attempt is reused, only approval is retried with the token.
      expect(createReturn).toHaveBeenCalledTimes(1);
      expect(approveReturn).toHaveBeenLastCalledWith(
        'r1',
        expect.objectContaining({ overrideToken: 'signed-token' }),
      );
    });
  });

  it('calls onProcessed with the return id when resolved as REPLACEMENT (O9.8)', async () => {
    createReturn.mockResolvedValue({ id: 'r1' });
    approveReturn.mockResolvedValue({ id: 'r1' });
    const onProcessed = vi.fn();

    render(<TillReturnSheet open onOpenChange={() => undefined} onProcessed={onProcessed} />);

    await userEvent.type(screen.getByLabelText(/order number/i), 'POS-1');
    await userEvent.click(screen.getByRole('button', { name: /look up/i }));
    await screen.findByText(/order pos-1/i);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText(/reason/i);
    await userEvent.click(screen.getByRole('combobox', { name: /resolution/i }));
    await userEvent.click(await screen.findByRole('option', { name: /replacement/i }));

    await userEvent.click(screen.getByRole('button', { name: /process return/i }));

    await waitFor(() => {
      expect(onProcessed).toHaveBeenCalledWith({ returnId: 'r1', resolution: 'REPLACEMENT' });
    });
  });

  it('calls onProcessed for a REFUND too — the component reports every resolution', async () => {
    createReturn.mockResolvedValue({ id: 'r1' });
    approveReturn.mockResolvedValue({ id: 'r1' });
    const onProcessed = vi.fn();

    render(<TillReturnSheet open onOpenChange={() => undefined} onProcessed={onProcessed} />);
    await lookUpAndSelectLine();

    await userEvent.click(screen.getByRole('button', { name: /process return/i }));

    await waitFor(() => {
      expect(onProcessed).toHaveBeenCalledWith({ returnId: 'r1', resolution: 'REFUND' });
    });
  });
});
