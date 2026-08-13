import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { GuestVsRegisteredView } from '../guest-vs-registered-view';

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
  usePathname: () => '/admin/reports/guest-vs-registered',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchGuestVsRegistered = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchGuestVsRegistered, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchGuestVsRegistered.mockReset();
  downloadReport.mockReset();
});

describe('guest vs registered view (C3.5)', () => {
  it('shows both buckets', async () => {
    fetchGuestVsRegistered.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      guest: { revenue: '20.00', orders: 1 },
      registered: { revenue: '400.00', orders: 8 },
    });

    render(<GuestVsRegisteredView />);

    expect(await screen.findByText('Guest')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchGuestVsRegistered.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<GuestVsRegisteredView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
