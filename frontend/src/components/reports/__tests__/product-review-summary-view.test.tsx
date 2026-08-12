import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ProductReviewSummaryView } from '../product-review-summary-view';

const urlState = vi.hoisted(() => {
  let current = new URLSearchParams();
  return {
    get: () => current,
    reset: () => {
      current = new URLSearchParams();
    },
    write: (href: string) => {
      current = new URLSearchParams(href.split('?')[1] ?? '');
    },
  };
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({ push: (href: string) => urlState.write(href), replace: (href: string) => urlState.write(href) }),
  usePathname: () => '/admin/reports/product-review-summary',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchProductReviewSummary = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchProductReviewSummary, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchProductReviewSummary.mockReset();
  downloadReport.mockReset();
});

describe('product review summary view (C3.5)', () => {
  it('lists products with review count and average rating', async () => {
    fetchProductReviewSummary.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      products: [
        {
          productId: 'p1',
          name: 'Widget',
          reviewCount: 3,
          averageRating: 4.3,
          distribution: { '1': 0, '2': 0, '3': 1, '4': 1, '5': 1 },
        },
      ],
    });

    render(<ProductReviewSummaryView />);

    expect(await screen.findByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('4.3')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchProductReviewSummary.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ProductReviewSummaryView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
