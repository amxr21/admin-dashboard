import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { StaffActivityView } from '../staff-activity-view';

/** Same stateful URL-bar stand-in `reports-view.test.tsx` uses. */
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
  usePathname: () => '/admin/reports/staff-activity',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      // no dynamic subscription needed for this simple stand-in
    }, [force]);
    return urlState.get();
  },
}));

const fetchStaffActivity = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchStaffActivity, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchStaffActivity.mockReset();
  downloadReport.mockReset();
});

describe('staff activity view (C3.5)', () => {
  it('lists staff with their action and denied counts', async () => {
    fetchStaffActivity.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      staff: [
        { actorId: 'u1', actorEmail: 'owner@example.test', actorRole: 'OWNER', actionCount: 42, deniedCount: 0 },
        { actorId: 'u2', actorEmail: 'support@example.test', actorRole: 'SUPPORT', actionCount: 5, deniedCount: 3 },
      ],
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-02-01T00:00:00.000Z',
    });

    render(<StaffActivityView />);

    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
    expect(screen.getByText('support@example.test')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows an empty state with zero activity', async () => {
    fetchStaffActivity.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      staff: [],
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-02-01T00:00:00.000Z',
    });

    render(<StaffActivityView />);

    expect(await screen.findByText(/no activity/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchStaffActivity.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<StaffActivityView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('exports for the current range in the chosen format', async () => {
    fetchStaffActivity.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      staff: [],
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-02-01T00:00:00.000Z',
    });
    downloadReport.mockResolvedValue(undefined);

    render(<StaffActivityView />);

    await userEvent.click(await screen.findByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX)' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('staff-activity', expect.any(Object), 'xlsx', undefined);
    });
  });
});
