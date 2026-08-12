import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { MovementLogSheet } from '../movement-log-sheet';
import type { MovementListResult, ReconcileResult, StockMovement } from '@/lib/inventory-api';

/**
 * B4.2/B4.3 — surfaced `GET /inventory/:productId/reconcile` (built with zero
 * frontend references) and closed the movement log's two real gaps: no
 * next-page control past 50 rows, and no rendering of WHO made each change
 * despite `actorId`/`actorName` already being in the response.
 */

const fetchMovements = vi.hoisted(() => vi.fn());
const fetchReconcile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/inventory-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inventory-api')>();
  return { ...actual, fetchMovements, fetchReconcile };
});

function makeMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: 'm1',
    delta: 5,
    reason: 'RECEIVED',
    note: null,
    actorId: 'u1',
    actorName: 'Ali',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<MovementListResult> = {}): MovementListResult {
  return {
    product: { id: 'p1', name: 'Widget', sku: 'W-1', stock: 5 },
    movements: [makeMovement()],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMovements.mockReset();
  fetchReconcile.mockReset();
  fetchMovements.mockResolvedValue(makeResult());
  fetchReconcile.mockResolvedValue({
    productId: 'p1',
    stock: 5,
    fromMovements: 5,
    agrees: true,
  } satisfies ReconcileResult);
});

describe('MovementLogSheet — actor rendering (B4.3)', () => {
  it('shows who made the change when the server resolved a name', async () => {
    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/by ali/i)).toBeInTheDocument();
  });

  it('omits the "by" text entirely when no actor name was resolved', async () => {
    fetchMovements.mockResolvedValue(
      makeResult({ movements: [makeMovement({ actorName: null })] }),
    );
    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);

    await screen.findByText(/received/i);
    expect(screen.queryByText(/^by /i)).not.toBeInTheDocument();
  });
});

describe('MovementLogSheet — pagination (B4.3)', () => {
  it('renders no pagination control when everything fits on one page', async () => {
    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);
    await screen.findByText(/received/i);
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('requests the next page and disables Previous on page 1', async () => {
    fetchMovements.mockResolvedValue(makeResult({ total: 40, totalPages: 2 }));
    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);

    await screen.findByText(/received/i);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();

    fetchMovements.mockResolvedValue(
      makeResult({ page: 2, total: 40, totalPages: 2, movements: [makeMovement({ id: 'm2' })] }),
    );
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(fetchMovements).toHaveBeenCalledWith('p1', { page: 2, pageSize: 20 }),
    );
  });

  it('resets to page 1 when reopened for a different product', async () => {
    fetchMovements.mockResolvedValue(makeResult({ total: 40, totalPages: 2 }));
    const { rerender } = render(
      <MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />,
    );
    await screen.findByText(/received/i);

    fetchMovements.mockResolvedValue(
      makeResult({ page: 2, total: 40, totalPages: 2, movements: [makeMovement({ id: 'm2' })] }),
    );
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(fetchMovements).toHaveBeenCalledWith('p1', { page: 2, pageSize: 20 }));

    fetchMovements.mockClear();
    fetchMovements.mockResolvedValue(makeResult({ product: { id: 'p2', name: 'Other', sku: null, stock: 1 } }));
    rerender(<MovementLogSheet productId="p2" open onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(fetchMovements).toHaveBeenCalledWith('p2', { page: 1, pageSize: 20 }),
    );
  });
});

describe('MovementLogSheet — reconcile (B4.2)', () => {
  it('shows an agreement state when the log matches the stock', async () => {
    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/log matches the current stock/i)).toBeInTheDocument();
  });

  it('surfaces a mismatch with both numbers named', async () => {
    fetchReconcile.mockResolvedValue({
      productId: 'p1',
      stock: 999,
      fromMovements: 5,
      agrees: false,
    } satisfies ReconcileResult);

    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);

    const alert = await screen.findByText(/does not match/i);
    expect(alert.textContent).toMatch(/999/);
    expect(alert.textContent).toMatch(/5/);
  });

  it('does not let a failed reconcile check block the movement log itself', async () => {
    fetchReconcile.mockRejectedValue(new Error('boom'));

    render(<MovementLogSheet productId="p1" open onOpenChange={vi.fn()} />);

    expect(await screen.findByText(/received/i)).toBeInTheDocument();
    expect(screen.queryByText(/log matches/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not match/i)).not.toBeInTheDocument();
  });
});
