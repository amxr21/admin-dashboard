import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ProductVariantsPanel } from '../product-variants-panel';
import type { Variant } from '@/lib/variants-api';

/**
 * Managing a product's variants. Stock follows the same append-only rule as
 * the top-level product — the property worth pinning is that the inline
 * adjust form mirrors `StockAdjustSheet`'s own refusal-before-submit
 * behaviour (never lets stock go negative) even though it's a compact inline
 * form rather than a separate Sheet.
 */

const fetchVariants = vi.hoisted(() => vi.fn());
const createVariant = vi.hoisted(() => vi.fn());
const updateVariant = vi.hoisted(() => vi.fn());
const deleteVariant = vi.hoisted(() => vi.fn());
const adjustVariantStock = vi.hoisted(() => vi.fn());
const fetchVariantMovements = vi.hoisted(() => vi.fn());
const fetchVariantReconcile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/variants-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/variants-api')>();
  return {
    ...actual,
    fetchVariants,
    createVariant,
    updateVariant,
    deleteVariant,
    adjustVariantStock,
    fetchVariantMovements,
    fetchVariantReconcile,
  };
});

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'v1',
    name: 'Red / Large',
    sku: 'SKU-RL',
    price: '24.99',
    stock: 10,
    productId: 'p1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(open = true) {
  const onOpenChange = vi.fn();
  const result = render(
    <ProductVariantsPanel
      productId="p1"
      productName="Ceramic Planter"
      open={open}
      onOpenChange={onOpenChange}
    />,
  );
  return { ...result, onOpenChange };
}

beforeEach(() => {
  fetchVariants.mockReset();
  createVariant.mockReset();
  updateVariant.mockReset();
  deleteVariant.mockReset();
  adjustVariantStock.mockReset();
  fetchVariantMovements.mockReset();
  fetchVariantReconcile.mockReset();
  fetchVariantReconcile.mockResolvedValue({
    variantId: 'v1',
    stock: 10,
    fromMovements: 10,
    agrees: true,
  });
});

describe('listing', () => {
  it('shows an empty state with no variants', async () => {
    fetchVariants.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/no variants yet/i)).toBeInTheDocument();
  });

  it('renders a variant with its name, SKU, price and stock', async () => {
    fetchVariants.mockResolvedValue([makeVariant()]);
    renderPanel();

    expect(await screen.findByText('Red / Large')).toBeInTheDocument();
    expect(screen.getByText('SKU-RL')).toBeInTheDocument();
    expect(screen.getByText('24.99')).toBeInTheDocument();
    expect(screen.getByText(/10 in stock/)).toBeInTheDocument();
  });
});

describe('creating a variant', () => {
  it('adds a variant and shows it in the list', async () => {
    fetchVariants.mockResolvedValue([]);
    createVariant.mockResolvedValue(makeVariant({ id: 'new', name: 'Blue / Small' }));
    renderPanel();

    await screen.findByText(/no variants yet/i);
    await userEvent.type(screen.getByLabelText('Name'), 'Blue / Small');
    await userEvent.type(screen.getByLabelText('Price'), '19.99');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(createVariant).toHaveBeenCalledWith('p1', {
        name: 'Blue / Small',
        sku: undefined,
        price: '19.99',
      });
    });
    expect(await screen.findByText('Blue / Small')).toBeInTheDocument();
  });

  it('disables Add until name and a valid price are both present', async () => {
    fetchVariants.mockResolvedValue([]);
    renderPanel();

    await screen.findByText(/no variants yet/i);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Name'), 'X');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Price'), '19.999');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });
});

describe('editing a variant', () => {
  it('pre-fills the form and sends only the update', async () => {
    fetchVariants.mockResolvedValue([makeVariant()]);
    updateVariant.mockResolvedValue(makeVariant({ price: '29.99' }));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Red / Large');

    const price = screen.getByLabelText('Price');
    await userEvent.clear(price);
    await userEvent.type(price, '29.99');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateVariant).toHaveBeenCalledWith('v1', {
        name: 'Red / Large',
        sku: 'SKU-RL',
        price: '29.99',
      });
    });
  });
});

describe('deleting a variant', () => {
  it('confirms before removing it', async () => {
    fetchVariants.mockResolvedValue([makeVariant()]);
    deleteVariant.mockResolvedValue(undefined);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /delete "red \/ large"/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteVariant).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(screen.queryByText('Red / Large')).not.toBeInTheDocument());
  });
});

describe('adjusting stock inline', () => {
  it('records a movement and updates the shown stock', async () => {
    fetchVariants.mockResolvedValue([makeVariant({ stock: 10 })]);
    adjustVariantStock.mockResolvedValue({
      variant: { id: 'v1', name: 'Red / Large', sku: 'SKU-RL', stock: 15 },
      movement: { id: 'm1', delta: 5, reason: 'RECEIVED', note: null, actorId: 'u1', createdAt: '2026-07-01T00:00:00.000Z' },
    });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock' }));
    await userEvent.click(screen.getByLabelText('Reason'));
    await userEvent.click(await screen.findByRole('option', { name: 'Received' }));
    await userEvent.type(screen.getByLabelText('Amount'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    await waitFor(() => {
      expect(adjustVariantStock).toHaveBeenCalledWith('v1', { delta: 5, reason: 'RECEIVED' });
    });
    expect(await screen.findByText(/15 in stock/)).toBeInTheDocument();
  });

  it('refuses to submit an amount that would go negative', async () => {
    fetchVariants.mockResolvedValue([makeVariant({ stock: 3 })]);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock' }));
    await userEvent.click(screen.getByLabelText('Reason'));
    await userEvent.click(await screen.findByRole('option', { name: 'Damaged' }));
    // DAMAGED implies "out" direction, so 5 out of a stock of 3 goes negative.
    await userEvent.type(screen.getByLabelText('Amount'), '5');

    expect(await screen.findByText(/would go negative/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
    expect(adjustVariantStock).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal reason on a failed adjustment', async () => {
    fetchVariants.mockResolvedValue([makeVariant({ stock: 10 })]);
    adjustVariantStock.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Only 10 in stock — that would leave -5'),
    );
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock' }));
    await userEvent.click(screen.getByLabelText('Reason'));
    await userEvent.click(await screen.findByRole('option', { name: 'Received' }));
    await userEvent.type(screen.getByLabelText('Amount'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText(/only 10 in stock/i)).toBeInTheDocument();
  });
});

describe('viewing history', () => {
  it('opens the movement log sheet scoped to the clicked variant', async () => {
    fetchVariants.mockResolvedValue([makeVariant()]);
    fetchVariantMovements.mockResolvedValue({
      variant: { id: 'v1', name: 'Red / Large', sku: 'SKU-RL', stock: 10 },
      movements: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'History' }));

    await waitFor(() => {
      expect(fetchVariantMovements).toHaveBeenCalledWith('v1', { page: 1, pageSize: 20 });
    });
    expect(await screen.findByText(/no movements recorded yet/i)).toBeInTheDocument();
  });
});
