import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CategoryBreakdownView } from '../category-breakdown-view';

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
  usePathname: () => '/admin/reports/category-breakdown',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchCategoryBreakdown = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCategoryBreakdown, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchCategoryBreakdown.mockReset();
  downloadReport.mockReset();
});

describe('category breakdown view (C3.5)', () => {
  it('lists categories with units, revenue, and a computed % of total', async () => {
    fetchCategoryBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      categories: [
        { categoryId: 'c1', categoryName: 'Home & Garden', units: 30, revenue: '300.00' },
        { categoryId: 'c2', categoryName: 'Stationery', units: 10, revenue: '100.00' },
      ],
    });

    render(<CategoryBreakdownView />);

    expect(await screen.findByText('Home & Garden')).toBeInTheDocument();
    expect(screen.getByText('Stationery')).toBeInTheDocument();
    // 300 / 400 = 75%
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows an explicit "(uncategorised)" bucket rather than dropping it', async () => {
    fetchCategoryBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      categories: [{ categoryId: null, categoryName: '(uncategorised)', units: 5, revenue: '50.00' }],
    });

    render(<CategoryBreakdownView />);

    expect(await screen.findByText('(uncategorised)')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchCategoryBreakdown.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CategoryBreakdownView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('exports in the chosen format', async () => {
    fetchCategoryBreakdown.mockResolvedValue({ range: { from: '2026-01-01', to: '2026-01-31' }, categories: [] });
    downloadReport.mockResolvedValue(undefined);

    render(<CategoryBreakdownView />);

    await userEvent.click(await screen.findByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX)' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('category-breakdown', expect.any(Object), 'xlsx', undefined);
    });
  });
});
