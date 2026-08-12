import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ReturnResolutionBreakdownView } from '../return-resolution-breakdown-view';

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
  usePathname: () => '/admin/reports/return-resolution-breakdown',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchReturnResolutionBreakdown = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchReturnResolutionBreakdown, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchReturnResolutionBreakdown.mockReset();
  downloadReport.mockReset();
});

describe('return resolution breakdown view (C3.5)', () => {
  it('translates resolution and status codes to their labels', async () => {
    fetchReturnResolutionBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      byResolution: [{ resolution: 'REFUND', count: 3, refundedValue: '150.00' }],
      byStatus: [{ status: 'APPROVED', count: 3 }],
    });

    render(<ReturnResolutionBreakdownView />);

    expect(await screen.findByText('Refund')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchReturnResolutionBreakdown.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ReturnResolutionBreakdownView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
