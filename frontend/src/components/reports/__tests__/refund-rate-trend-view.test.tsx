import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { RefundRateTrendView } from '../refund-rate-trend-view';

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
  usePathname: () => '/admin/reports/refund-rate-trend',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchRefundRateTrend = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchRefundRateTrend, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchRefundRateTrend.mockReset();
  downloadReport.mockReset();
});

describe('refund rate trend view (C3.5)', () => {
  it('lists monthly points with revenue, refunded and rate', async () => {
    fetchRefundRateTrend.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-02-28' },
      points: [
        { date: '2026-01-01', revenue: '1000.00', refunded: '250.00', refundRate: 0.25 },
        { date: '2026-02-01', revenue: '2000.00', refunded: '0.00', refundRate: 0 },
      ],
    });

    render(<RefundRateTrendView />);

    expect(await screen.findByText('25%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('shows an empty state with no points', async () => {
    fetchRefundRateTrend.mockResolvedValue({ range: { from: '2026-01-01', to: '2026-01-31' }, points: [] });

    render(<RefundRateTrendView />);

    expect(await screen.findByText(/no data/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchRefundRateTrend.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<RefundRateTrendView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('exports in the chosen format', async () => {
    fetchRefundRateTrend.mockResolvedValue({ range: { from: '2026-01-01', to: '2026-01-31' }, points: [] });
    downloadReport.mockResolvedValue(undefined);

    render(<RefundRateTrendView />);

    await userEvent.click(await screen.findByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX)' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('refund-rate-trend', expect.any(Object), 'xlsx', undefined);
    });
  });
});
