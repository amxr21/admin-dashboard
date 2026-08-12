import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { AuditActivityByEntityView } from '../audit-activity-by-entity-view';

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
  usePathname: () => '/admin/reports/audit-activity-by-entity',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchAuditActivityByEntity = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchAuditActivityByEntity, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchAuditActivityByEntity.mockReset();
  downloadReport.mockReset();
});

describe('audit activity by entity view (C3.5)', () => {
  it('lists entity/action rows with counts', async () => {
    fetchAuditActivityByEntity.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      rows: [{ entity: 'products', action: 'product.updated', count: 340 }],
    });

    render(<AuditActivityByEntityView />);

    expect(await screen.findByText('products')).toBeInTheDocument();
    expect(screen.getByText('product.updated')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchAuditActivityByEntity.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<AuditActivityByEntityView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
