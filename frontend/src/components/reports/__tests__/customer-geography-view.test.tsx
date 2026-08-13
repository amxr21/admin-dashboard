import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CustomerGeographyView } from '../customer-geography-view';

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
  usePathname: () => '/admin/reports/customer-geography',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchCustomerGeography = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCustomerGeography, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchCustomerGeography.mockReset();
  downloadReport.mockReset();
});

describe('customer geography view (C3.5)', () => {
  it('lists rows with city, country, revenue and orders', async () => {
    fetchCustomerGeography.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      rows: [{ city: 'Dubai', country: 'AE', revenue: '500.00', orders: 5 }],
    });

    render(<CustomerGeographyView />);

    expect(await screen.findByText('Dubai')).toBeInTheDocument();
    expect(screen.getByText('AE')).toBeInTheDocument();
  });

  it('shows the "(unknown)" bucket for a guest order rather than dropping it', async () => {
    fetchCustomerGeography.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      rows: [{ city: '(unknown)', country: '(unknown)', revenue: '20.00', orders: 1 }],
    });

    render(<CustomerGeographyView />);

    expect(await screen.findAllByText('(unknown)')).toHaveLength(2);
  });

  it('surfaces a load failure', async () => {
    fetchCustomerGeography.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CustomerGeographyView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
