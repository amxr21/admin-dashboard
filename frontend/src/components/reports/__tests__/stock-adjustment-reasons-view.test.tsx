import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { StockAdjustmentReasonsView } from '../stock-adjustment-reasons-view';

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
  usePathname: () => '/admin/reports/stock-adjustment-reasons',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchStockAdjustmentReasons = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchStockAdjustmentReasons, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchStockAdjustmentReasons.mockReset();
  downloadReport.mockReset();
});

describe('stock adjustment reasons view (C3.5)', () => {
  it('translates a known reason code to its label', async () => {
    fetchStockAdjustmentReasons.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      reasons: [{ reason: 'RECEIVED', movements: 4, netUnits: 120 }],
    });

    render(<StockAdjustmentReasonsView />);

    expect(await screen.findByText('Received')).toBeInTheDocument();
  });

  it('keeps a signed net-units value rather than flattening to an absolute', async () => {
    fetchStockAdjustmentReasons.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      reasons: [{ reason: 'DAMAGED', movements: 2, netUnits: -8 }],
    });

    render(<StockAdjustmentReasonsView />);

    expect(await screen.findByText('-8')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchStockAdjustmentReasons.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<StockAdjustmentReasonsView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
