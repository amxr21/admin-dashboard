import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CustomerNewVsReturningView } from '../customer-new-vs-returning-view';

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
  usePathname: () => '/admin/reports/customer-new-vs-returning',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchCustomerNewVsReturning = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCustomerNewVsReturning, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchCustomerNewVsReturning.mockReset();
  downloadReport.mockReset();
});

describe('customer new vs returning view (C3.5)', () => {
  it('shows revenue for both buckets', async () => {
    fetchCustomerNewVsReturning.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      new: { revenue: '100.00', orders: 2 },
      returning: { revenue: '300.00', orders: 4 },
    });

    render(<CustomerNewVsReturningView />);

    expect(await screen.findByText('New customers')).toBeInTheDocument();
    expect(screen.getByText('Returning customers')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchCustomerNewVsReturning.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CustomerNewVsReturningView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
