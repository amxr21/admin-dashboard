import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { AuditOutcomeTrendView } from '../audit-outcome-trend-view';

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
  usePathname: () => '/admin/reports/audit-outcome-trend',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchAuditOutcomeTrend = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchAuditOutcomeTrend, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchAuditOutcomeTrend.mockReset();
  downloadReport.mockReset();
});

describe('audit outcome trend view (C3.5)', () => {
  it('lists daily points with success/denied/error counts', async () => {
    fetchAuditOutcomeTrend.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      points: [{ date: '2026-01-05', success: 40, denied: 2, error: 0 }],
    });

    render(<AuditOutcomeTrendView />);

    expect(await screen.findByText('40')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchAuditOutcomeTrend.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<AuditOutcomeTrendView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
