import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CourierPerformanceView } from '../courier-performance-view';

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
  usePathname: () => '/admin/reports/courier-performance',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchCourierPerformance = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCourierPerformance, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchCourierPerformance.mockReset();
  downloadReport.mockReset();
});

describe('courier performance view (C3.5)', () => {
  it('lists couriers with per-status assignment counts', async () => {
    fetchCourierPerformance.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      couriers: [
        { driverId: 'd1', name: 'Sami Haddad', total: 10, byStatus: { DELIVERED: 8, OUT_FOR_DELIVERY: 2 } },
      ],
    });

    render(<CourierPerformanceView />);

    expect(await screen.findByText('Sami Haddad')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchCourierPerformance.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CourierPerformanceView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
