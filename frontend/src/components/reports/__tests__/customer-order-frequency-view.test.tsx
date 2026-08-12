import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CustomerOrderFrequencyView } from '../customer-order-frequency-view';

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
  usePathname: () => '/admin/reports/customer-order-frequency',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchCustomerOrderFrequency = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCustomerOrderFrequency, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchCustomerOrderFrequency.mockReset();
  downloadReport.mockReset();
});

describe('customer order frequency view (C3.5)', () => {
  it('shows the repeat rate and per-bucket counts', async () => {
    fetchCustomerOrderFrequency.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      buckets: [
        { label: '1', customers: 10 },
        { label: '2', customers: 4 },
        { label: '3', customers: 1 },
        { label: '4+', customers: 1 },
      ],
      totalCustomers: 16,
      repeatRate: 0.375,
    });

    render(<CustomerOrderFrequencyView />);

    expect(await screen.findByText('37.5%')).toBeInTheDocument();
    expect(screen.getByText('4+')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchCustomerOrderFrequency.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CustomerOrderFrequencyView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
