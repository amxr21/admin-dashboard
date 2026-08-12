import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { VariantStockMovementView } from '../variant-stock-movement-view';

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
  usePathname: () => '/admin/reports/variant-stock-movement',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchVariantStockMovement = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchVariantStockMovement, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchVariantStockMovement.mockReset();
  downloadReport.mockReset();
});

describe('variant stock movement view (C3.5)', () => {
  it('lists variants with their own product name and sold/received counts', async () => {
    fetchVariantStockMovement.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      variants: [
        { variantId: 'v1', name: 'Red / L', productName: 'T-Shirt', sku: 'TS-RL', stock: 10, sold: 5, received: 20 },
      ],
    });

    render(<VariantStockMovementView />);

    expect(await screen.findByText('T-Shirt')).toBeInTheDocument();
    expect(screen.getByText('Red / L')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchVariantStockMovement.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<VariantStockMovementView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
