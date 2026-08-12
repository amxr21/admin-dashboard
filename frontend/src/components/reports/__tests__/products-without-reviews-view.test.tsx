import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ProductsWithoutReviewsView } from '../products-without-reviews-view';

const fetchProductsWithoutReviews = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchProductsWithoutReviews };
});

beforeEach(() => {
  fetchProductsWithoutReviews.mockReset();
});

describe('products without reviews view (C3.5)', () => {
  it('lists unreviewed products, no date range control', async () => {
    fetchProductsWithoutReviews.mockResolvedValue({
      products: [{ productId: 'p1', name: 'Widget', sku: 'W-1' }],
    });

    render(<ProductsWithoutReviewsView />);

    expect(await screen.findByText('Widget')).toBeInTheDocument();
    expect(fetchProductsWithoutReviews).toHaveBeenCalledWith();
  });

  it('shows an empty state when every product has a review', async () => {
    fetchProductsWithoutReviews.mockResolvedValue({ products: [] });

    render(<ProductsWithoutReviewsView />);

    expect(await screen.findByText(/every active product has at least one review/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchProductsWithoutReviews.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ProductsWithoutReviewsView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
