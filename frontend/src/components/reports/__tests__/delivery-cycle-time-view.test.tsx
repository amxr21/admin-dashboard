import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { DeliveryCycleTimeView } from '../delivery-cycle-time-view';

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
  usePathname: () => '/admin/reports/delivery-cycle-time',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchDeliveryCycleTime = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchDeliveryCycleTime, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchDeliveryCycleTime.mockReset();
  downloadReport.mockReset();
});

describe('delivery cycle time view (C3.5)', () => {
  it('shows delivered count, average and median hours', async () => {
    fetchDeliveryCycleTime.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      deliveredCount: 40,
      averageHours: 18.4,
      medianHours: 16,
    });

    render(<DeliveryCycleTimeView />);

    expect(await screen.findByText('18.4')).toBeInTheDocument();
    expect(screen.getByText('16')).toBeInTheDocument();
  });

  it('renders an em dash rather than 0 when nothing was delivered in range', async () => {
    fetchDeliveryCycleTime.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      deliveredCount: 0,
      averageHours: null,
      medianHours: null,
    });

    render(<DeliveryCycleTimeView />);

    expect(await screen.findAllByText('—')).toHaveLength(2);
  });

  it('surfaces a load failure', async () => {
    fetchDeliveryCycleTime.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<DeliveryCycleTimeView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
