import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { PaymentMethodBreakdownView } from '../payment-method-breakdown-view';

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
  usePathname: () => '/admin/reports/payment-method-breakdown',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchPaymentMethodBreakdown = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchPaymentMethodBreakdown, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchPaymentMethodBreakdown.mockReset();
  downloadReport.mockReset();
});

describe('payment method breakdown view (C3.5)', () => {
  it('lists methods with revenue and orders', async () => {
    fetchPaymentMethodBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      methods: [{ paymentMethod: 'card', revenue: '400.00', orders: 4 }],
    });

    render(<PaymentMethodBreakdownView />);

    expect(await screen.findByText('card')).toBeInTheDocument();
  });

  it('shows "(not recorded)" for a missing method', async () => {
    fetchPaymentMethodBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      methods: [{ paymentMethod: '(not recorded)', revenue: '20.00', orders: 1 }],
    });

    render(<PaymentMethodBreakdownView />);

    expect(await screen.findByText('(not recorded)')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchPaymentMethodBreakdown.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<PaymentMethodBreakdownView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
