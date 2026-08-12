import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ReturnReasonsView } from '../return-reasons-view';

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
  usePathname: () => '/admin/reports/return-reasons',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchReturnReasons = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchReturnReasons, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchReturnReasons.mockReset();
  downloadReport.mockReset();
});

describe('return reasons view (C3.5)', () => {
  it('shows the real reason text verbatim, not a fabricated category', async () => {
    fetchReturnReasons.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      returns: [
        { rmaNumber: 'RMA-001', reason: 'Wrong size delivered', status: 'APPROVED', createdAt: '2026-01-05T00:00:00.000Z' },
      ],
    });

    render(<ReturnReasonsView />);

    expect(await screen.findByText('Wrong size delivered')).toBeInTheDocument();
    expect(screen.getByText('RMA-001')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchReturnReasons.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ReturnReasonsView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
