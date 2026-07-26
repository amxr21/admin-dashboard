import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ProductsTable } from '../products-table';
import type { Product } from '@/lib/products';

/**
 * The catalogue list.
 *
 * The cases worth pinning are the ones that go wrong silently: money losing
 * precision on the way through the client, and a failed request rendering as
 * an empty catalogue instead of an error.
 */

const fetchProducts = vi.hoisted(() => vi.fn());

vi.mock('@/lib/products', () => ({ fetchProducts }));

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Widget',
    sku: 'SKU-1',
    description: null,
    price: '19.99',
    imageUrl: null,
    status: 'ACTIVE',
    stock: 5,
    categoryId: 'c1',
    category: { id: 'c1', name: 'Tools', slug: 'tools' },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function resolveWith(products: Product[], total = products.length) {
  fetchProducts.mockResolvedValue({
    products,
    total,
    page: 1,
    limit: 20,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  });
}

beforeEach(() => {
  fetchProducts.mockReset();
});

describe('rendering', () => {
  it('shows products once loaded', async () => {
    resolveWith([makeProduct()]);

    render(<ProductsTable />);

    expect(await screen.findByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
  });

  it('formats price from the decimal string', async () => {
    // The API sends "19.99". It must render as currency, and the string must
    // never be treated as app state to do arithmetic on.
    resolveWith([makeProduct({ price: '1234.50' })]);

    render(<ProductsTable />);

    expect(await screen.findByText(/1,234\.50/)).toBeInTheDocument();
  });

  it('marks a zero-stock product distinctly', async () => {
    // Out of stock is an operational problem, not just a number.
    resolveWith([makeProduct({ stock: 0 })]);

    const { container } = render(<ProductsTable />);

    await screen.findByText('Widget');
    expect(container.querySelector('.text-destructive')).toBeTruthy();
  });
});

describe('failure states', () => {
  it('renders an error, not an empty catalogue, when the request fails', async () => {
    // An empty table after a failed fetch reads as "you have no products",
    // which is a different and much worse statement than "loading failed".
    fetchProducts.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ProductsTable />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });

  it('distinguishes an expired session from a generic failure', async () => {
    // 401 is recoverable by signing in again. Collapsing it into "something
    // went wrong" hides the one action that would fix it.
    fetchProducts.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));

    render(<ProductsTable />);

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });

  it('treats a non-ApiError as a network problem', async () => {
    // fetch rejects rather than resolving when the network is unreachable.
    fetchProducts.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<ProductsTable />);

    expect(await screen.findByText(/can't reach the server/i)).toBeInTheDocument();
  });

  it('shows the empty state when there genuinely are no products', async () => {
    resolveWith([]);

    render(<ProductsTable />);

    expect(await screen.findByText(/no products yet/i)).toBeInTheDocument();
  });
});

describe('filtering', () => {
  it('asks the SERVER to filter by status rather than filtering locally', async () => {
    // Client-side filtering works at 40 products and ships 4,000 rows to a
    // phone at scale. The request must carry the filter.
    resolveWith([makeProduct()]);

    render(<ProductsTable />);
    await screen.findByText('Widget');

    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Draft' }));

    await waitFor(() => {
      expect(fetchProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'DRAFT' }),
      );
    });
  });

  it('omits the status filter entirely when set to all', async () => {
    // Sending `status=all` would be rejected — the API validates the enum
    // strictly, so "no filter" must mean "no parameter".
    resolveWith([makeProduct()]);

    render(<ProductsTable />);
    await screen.findByText('Widget');

    expect(fetchProducts).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });
});

describe('localisation', () => {
  it('renders Arabic column headers', async () => {
    resolveWith([makeProduct()]);

    render(<ProductsTable />, { locale: 'ar' });

    expect(await screen.findByText('المنتج')).toBeInTheDocument();
    expect(screen.getByText('المخزون')).toBeInTheDocument();
  });
});
