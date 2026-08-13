import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { VariantMovementLogSheet } from '../variant-movement-log-sheet';

/**
 * A5.4 — variant stock history, mirroring the product-level
 * `movement-log-sheet.tsx`'s behavior: newest-first log, pagination, and a
 * best-effort reconcile-mismatch banner that must never block the log itself.
 */

const fetchVariantMovements = vi.hoisted(() => vi.fn());
const fetchVariantReconcile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/variants-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/variants-api')>();
  return {
    ...actual,
    fetchVariantMovements,
    fetchVariantReconcile,
  };
});

function renderSheet(variantId: string | null = 'variant-1', open = true) {
  const onOpenChange = vi.fn();
  const result = render(
    <VariantMovementLogSheet variantId={variantId} open={open} onOpenChange={onOpenChange} />,
  );
  return { ...result, onOpenChange };
}

function movementsPage(overrides: Partial<Parameters<typeof fetchVariantMovements>[0]> = {}) {
  void overrides;
  return {
    variant: { id: 'variant-1', name: 'Red / Large', sku: 'RL-1', stock: 12 },
    movements: [
      {
        id: 'm1',
        delta: -3,
        reason: 'SOLD' as const,
        note: 'Order #9',
        actorId: 'u1',
        actorName: 'Sam',
        createdAt: '2026-08-01T10:00:00.000Z',
      },
      {
        id: 'm2',
        delta: 15,
        reason: 'RECEIVED' as const,
        note: null,
        actorId: 'u1',
        actorName: 'Sam',
        createdAt: '2026-07-30T10:00:00.000Z',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

beforeEach(() => {
  fetchVariantMovements.mockReset();
  fetchVariantReconcile.mockReset();
  fetchVariantReconcile.mockResolvedValue({
    variantId: 'variant-1',
    stock: 12,
    fromMovements: 12,
    agrees: true,
  });
});

describe('loading and displaying movements', () => {
  it('fetches and renders the log for the given variant when opened', async () => {
    fetchVariantMovements.mockResolvedValue(movementsPage());
    renderSheet();

    await waitFor(() => {
      expect(fetchVariantMovements).toHaveBeenCalledWith('variant-1', { page: 1, pageSize: 20 });
    });

    expect(await screen.findAllByText(/Sam/)).toHaveLength(2);
    expect(screen.getByText(/\+15/)).toBeInTheDocument();
    expect(screen.getByText(/−3/)).toBeInTheDocument();
    expect(screen.getByText('Order #9')).toBeInTheDocument();
  });

  it('does not fetch anything when there is no variant selected', () => {
    renderSheet(null);
    expect(fetchVariantMovements).not.toHaveBeenCalled();
  });

  it('shows an empty state, not an error, when a variant genuinely has no movements', async () => {
    fetchVariantMovements.mockResolvedValue({
      variant: { id: 'variant-1', name: 'Red / Large', sku: null, stock: 0 },
      movements: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    renderSheet();

    expect(await screen.findByText(/no movements recorded yet/i)).toBeInTheDocument();
  });

  it('surfaces a fetch failure as an error', async () => {
    fetchVariantMovements.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', undefined));
    renderSheet();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('pagination', () => {
  it('requests the next page and resets to page 1 when reopened for a different variant', async () => {
    fetchVariantMovements.mockResolvedValue({
      ...movementsPage(),
      totalPages: 2,
    });
    renderSheet();

    await screen.findAllByText(/Sam/);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(fetchVariantMovements).toHaveBeenCalledWith('variant-1', { page: 2, pageSize: 20 });
    });
  });
});

describe('reconcile banner', () => {
  it('shows a mismatch warning when the log disagrees with recorded stock', async () => {
    fetchVariantMovements.mockResolvedValue(movementsPage());
    fetchVariantReconcile.mockResolvedValue({
      variantId: 'variant-1',
      stock: 12,
      fromMovements: 9,
      agrees: false,
    });
    renderSheet();

    expect(await screen.findByText(/does not match the log total/i)).toBeInTheDocument();
  });

  it('does not block the movement log when the reconcile check itself fails', async () => {
    fetchVariantMovements.mockResolvedValue(movementsPage());
    fetchVariantReconcile.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', undefined));
    renderSheet();

    expect(await screen.findAllByText(/Sam/)).toHaveLength(2);
    expect(screen.queryByText(/does not match the log total/i)).not.toBeInTheDocument();
  });
});
