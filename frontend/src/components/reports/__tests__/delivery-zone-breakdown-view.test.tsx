import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { DeliveryZoneBreakdownView } from '../delivery-zone-breakdown-view';

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
  usePathname: () => '/admin/reports/delivery-zone-breakdown',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchDeliveryZoneBreakdown = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchDeliveryZoneBreakdown, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchDeliveryZoneBreakdown.mockReset();
  downloadReport.mockReset();
});

describe('delivery zone breakdown view (C3.5)', () => {
  it('lists zones with assignment counts and collectible value', async () => {
    fetchDeliveryZoneBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      zones: [{ zone: 'North', region: 'NR', assignments: 12, collectibleValue: '900.00' }],
    });

    render(<DeliveryZoneBreakdownView />);

    expect(await screen.findByText('North')).toBeInTheDocument();
  });

  it('states the zone is a courier-home proxy, not a real delivery-area field', async () => {
    fetchDeliveryZoneBreakdown.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      zones: [],
    });

    render(<DeliveryZoneBreakdownView />);

    expect(await screen.findByText(/courier's own home zone\/region instead/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchDeliveryZoneBreakdown.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<DeliveryZoneBreakdownView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
