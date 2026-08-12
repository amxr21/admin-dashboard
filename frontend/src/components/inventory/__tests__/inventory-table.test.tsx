import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { InventoryTable } from '../inventory-table';
import type { InventoryRow } from '@/lib/inventory-api';

/**
 * Inventory.
 *
 * Two properties carry this screen. First, the low-stock rule is the SERVER's
 * — rows arrive with `isLow` already decided, so the badge and the filter
 * cannot drift apart or disagree with the API. Second, an adjustment states
 * its consequence before it happens: the log is append-only, so a movement
 * recorded in the wrong direction is corrected in the trail forever.
 */

const fetchInventory = vi.hoisted(() => vi.fn());
const fetchMovements = vi.hoisted(() => vi.fn());
const adjustStock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/inventory-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inventory-api')>();
  return { ...actual, fetchInventory, fetchMovements, adjustStock };
});

/**
 * A STATEFUL stand-in for the URL bar.
 *
 * Search, the low-stock toggle and the page round-trip through the query
 * string. A mock that swallowed writes and kept reporting an empty
 * `useSearchParams()` would break that loop — the component would write the
 * filter, read back "no filter", and never re-fetch — so the assertions below
 * about asking the SERVER for the low-stock view would pass while the feature
 * was broken.
 *
 * The router half comes from `vitest.setup.ts`, but its `replace` is inert, so
 * it is overridden here to feed this store.
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
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({
    push: (href: string) => urlState.write(href),
    replace: (href: string) => urlState.write(href),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/admin/inventory',
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

function makeRow(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: 'p1',
    name: 'Ceramic Planter',
    sku: 'SKU-1',
    stock: 12,
    status: 'ACTIVE',
    imageUrl: null,
    category: { id: 'c1', name: 'Home' },
    isLow: false,
    ...overrides,
  };
}

function resolveWith(products: InventoryRow[], threshold = 5) {
  fetchInventory.mockResolvedValue({
    products,
    total: products.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    threshold,
  });
}

beforeEach(() => {
  // The low-stock filter persists in the URL now, so without this it would
  // leak into the next test's initial fetch.
  urlState.reset();
  fetchInventory.mockReset();
  fetchMovements.mockReset();
  adjustStock.mockReset();
});

describe('the low-stock rule belongs to the server', () => {
  it('flags a row because the API said so, not by recomputing', async () => {
    // stock 40 with isLow true would be nonsense under any local rule — which
    // is exactly why it proves the UI is not applying one.
    resolveWith([makeRow({ stock: 40, isLow: true })], 50);

    render(<InventoryTable />);

    expect(await screen.findByText(/low \(≤ 50\)/i)).toBeInTheDocument();
  });

  it('leaves an ample row unflagged', async () => {
    resolveWith([makeRow({ stock: 900, isLow: false })]);

    render(<InventoryTable />);

    await screen.findByText('Ceramic Planter');
    expect(screen.queryByText(/low \(/i)).not.toBeInTheDocument();
  });

  it('asks the server for the low-stock view rather than filtering locally', async () => {
    resolveWith([makeRow()]);

    render(<InventoryTable />);
    await screen.findByText('Ceramic Planter');

    await userEvent.click(screen.getByRole('button', { name: /low stock only/i }));

    await waitFor(() => {
      expect(fetchInventory).toHaveBeenLastCalledWith(
        expect.objectContaining({ lowStock: true }),
      );
    });
  });

  it('omits the flag entirely when the filter is off', async () => {
    // `lowStock: false` would still be a filter as far as the API is concerned.
    resolveWith([makeRow()]);

    render(<InventoryTable />);
    await screen.findByText('Ceramic Planter');

    expect(fetchInventory).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ lowStock: expect.anything() }),
    );
  });
});

describe('recording a movement', () => {
  async function openAdjust() {
    resolveWith([makeRow({ stock: 12 })]);
    render(<InventoryTable />);
    await screen.findByText('Ceramic Planter');
    await userEvent.click(screen.getByRole('button', { name: /adjust stock for/i }));
    return screen.findByLabelText(/^amount$/i);
  }

  it('sends a positive delta when adding', async () => {
    adjustStock.mockResolvedValue({
      product: { id: 'p1', name: 'Ceramic Planter', sku: null, stock: 62 },
      movement: { id: 'm1', delta: 50, reason: 'RECEIVED', note: null, actorId: 'u1', createdAt: '' },
    });

    const amount = await openAdjust();

    await userEvent.click(screen.getByLabelText(/reason/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Received' }));
    await userEvent.type(amount, '50');
    await userEvent.click(screen.getByRole('button', { name: /record movement/i }));

    await waitFor(() => {
      expect(adjustStock).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ delta: 50, reason: 'RECEIVED' }),
      );
    });
  });

  it('sends a negative delta when removing', async () => {
    adjustStock.mockResolvedValue({
      product: { id: 'p1', name: 'Ceramic Planter', sku: null, stock: 9 },
      movement: { id: 'm1', delta: -3, reason: 'DAMAGED', note: null, actorId: 'u1', createdAt: '' },
    });

    const amount = await openAdjust();

    // DAMAGED only makes sense outbound, so choosing it sets the direction —
    // "damaged" ADDING stock is almost always a mis-click.
    await userEvent.click(screen.getByLabelText(/reason/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Damaged' }));
    await userEvent.type(amount, '3');
    await userEvent.click(screen.getByRole('button', { name: /record movement/i }));

    await waitFor(() => {
      expect(adjustStock).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ delta: -3, reason: 'DAMAGED' }),
      );
    });
  });

  it('shows the resulting stock before committing', async () => {
    // The log is append-only, so a wrong movement lives in the trail forever.
    // Seeing the consequence first is what prevents it.
    const amount = await openAdjust();

    await userEvent.click(screen.getByLabelText(/reason/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Received' }));
    await userEvent.type(amount, '8');

    expect(await screen.findByText('12 → 20')).toBeInTheDocument();
  });

  it('refuses an adjustment that would go below zero, without calling the API', async () => {
    const amount = await openAdjust();

    await userEvent.click(screen.getByLabelText(/reason/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Sold' }));
    await userEvent.type(amount, '99');

    expect(await screen.findByText(/below zero/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record movement/i })).toBeDisabled();
    expect(adjustStock).not.toHaveBeenCalled();
  });

  it('will not submit without a reason', async () => {
    // An unexplained adjustment is indistinguishable from a mistake later.
    const amount = await openAdjust();

    await userEvent.type(amount, '5');

    expect(screen.getByRole('button', { name: /record movement/i })).toBeDisabled();
  });

  it('keeps the server refusal rather than flattening it', async () => {
    // The API's 400 names the numbers; "something went wrong" would not.
    adjustStock.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Only 12 in stock — that would leave -8'),
    );

    const amount = await openAdjust();

    await userEvent.click(screen.getByLabelText(/reason/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Received' }));
    await userEvent.type(amount, '4');
    await userEvent.click(screen.getByRole('button', { name: /record movement/i }));

    expect(await screen.findByText(/that would leave -8/i)).toBeInTheDocument();
  });
});

describe('the movement log', () => {
  it('shows signed deltas with their reasons', async () => {
    resolveWith([makeRow()]);
    fetchMovements.mockResolvedValue({
      product: { id: 'p1', name: 'Ceramic Planter', sku: null, stock: 47 },
      movements: [
        { id: 'm2', delta: -3, reason: 'DAMAGED', note: 'pallet 4', actorId: 'u1', createdAt: '2026-07-02T10:00:00.000Z' },
        { id: 'm1', delta: 50, reason: 'RECEIVED', note: null, actorId: 'u1', createdAt: '2026-07-01T10:00:00.000Z' },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    render(<InventoryTable />);
    await screen.findByText('Ceramic Planter');

    await userEvent.click(screen.getByRole('button', { name: /stock history for/i }));

    // Explicit signs: "+50" reads as a movement, a bare 50 reads as a quantity.
    expect(await screen.findByText('+50')).toBeInTheDocument();
    expect(screen.getByText('−3')).toBeInTheDocument();
    expect(screen.getByText('pallet 4')).toBeInTheDocument();
  });

  it('distinguishes an empty history from a failure', async () => {
    resolveWith([makeRow()]);
    fetchMovements.mockResolvedValue({
      product: { id: 'p1', name: 'Ceramic Planter', sku: null, stock: 0 },
      movements: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    render(<InventoryTable />);
    await screen.findByText('Ceramic Planter');
    await userEvent.click(screen.getByRole('button', { name: /stock history for/i }));

    expect(await screen.findByText(/no movements recorded/i)).toBeInTheDocument();
  });
});

describe('failure and empty states', () => {
  it('renders an error rather than an empty catalogue', async () => {
    fetchInventory.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<InventoryTable />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });

  it('says nothing is low rather than "no results" under the filter', async () => {
    resolveWith([makeRow()]);
    render(<InventoryTable />);
    await screen.findByText('Ceramic Planter');

    resolveWith([]);
    await userEvent.click(screen.getByRole('button', { name: /low stock only/i }));

    expect(await screen.findByText(/nothing is running low/i)).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders Arabic headers and reasons', async () => {
    resolveWith([makeRow()]);

    render(<InventoryTable />, { locale: 'ar' });

    expect(await screen.findByText('المتوفر')).toBeInTheDocument();
  });
});
