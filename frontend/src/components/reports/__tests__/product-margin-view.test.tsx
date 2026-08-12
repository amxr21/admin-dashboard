import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ProductMarginView } from '../product-margin-view';

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
  usePathname: () => '/admin/reports/product-margin',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchProductMargin = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchProductMargin, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchProductMargin.mockReset();
  downloadReport.mockReset();
});

describe('product margin view (C3.5)', () => {
  it('lists products with revenue, COGS and margin', async () => {
    fetchProductMargin.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      products: [
        { productId: 'p1', name: 'Widget', sku: 'W-1', revenue: '100.00', cogs: '40.00', margin: '60.00', marginPercent: 0.6, units: 5 },
      ],
      productsWithoutCost: 0,
    });

    render(<ProductMarginView />);

    expect(await screen.findByText('Widget')).toBeInTheDocument();
  });

  it('states the count of products excluded for having no recorded cost', async () => {
    fetchProductMargin.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      products: [],
      productsWithoutCost: 3,
    });

    render(<ProductMarginView />);

    expect(await screen.findByText(/3 other products/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchProductMargin.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ProductMarginView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
