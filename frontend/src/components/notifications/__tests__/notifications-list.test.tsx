import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { ApiError } from '@/lib/api';
import { NotificationsList } from '../notifications-list';
import type { ResourceRow } from '@/lib/resource-api';

/**
 * The bespoke card-based `/admin/notifications` page — the generic
 * table-and-edit-form page it replaced let someone "edit" a notification
 * through a pencil icon, which never actually read like a notification (see
 * admin.config.ts's `permissions.update: false`). The property worth
 * pinning hardest: dismiss goes through the REAL `AlertDialog` primitive
 * (`role="alertdialog"`, which only a real Radix dialog gets for free) — a
 * hand-rolled `<div role="alertdialog">` was caught and rewritten once
 * already this session, the exact anti-pattern responsible for a prior P0
 * off-screen bug elsewhere in the app.
 */

const fetchRows = vi.hoisted(() => vi.fn());
const deleteRow = vi.hoisted(() => vi.fn());
const markAllNotificationsRead = vi.hoisted(() => vi.fn());
const markNotificationRead = vi.hoisted(() => vi.fn());

const urlState = vi.hoisted(() => {
  let current = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    reset: () => { current = new URLSearchParams(); },
    write: (href: string) => {
      current = new URLSearchParams(href.split('?')[1] ?? '');
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({ push: urlState.write, replace: urlState.write }),
  usePathname: () => '/admin/notifications',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, fetchRows, deleteRow };
});

vi.mock('@/lib/notifications-api', () => ({
  markAllNotificationsRead,
  markNotificationRead,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'OWNER' } }),
}));

function makeRow(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'n1',
    title: 'Low stock: Ceramic Planter',
    body: 'Only 3 units left in stock.',
    link: null,
    isRead: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function resolveWith(rows: ResourceRow[]) {
  fetchRows.mockImplementation((_resource: string, params: { pageSize?: number; filters?: { isRead?: string } }) => {
    const unread = rows.filter((row) => !row.isRead);
    if (params.pageSize === 1 && params.filters?.isRead === 'false') {
      return Promise.resolve({ rows: [], total: unread.length, page: 1, pageSize: 1, totalPages: 1 });
    }
    return Promise.resolve({
      rows,
      total: rows.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });
}

beforeEach(() => {
  urlState.reset();
  fetchRows.mockReset();
  deleteRow.mockReset();
  markAllNotificationsRead.mockReset();
  markNotificationRead.mockReset();
  markNotificationRead.mockResolvedValue(undefined);
});

describe('the list', () => {
  it('shows a genuinely empty state, not a table with zero rows', async () => {
    resolveWith([]);

    render(<NotificationsList />);

    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });

  it('renders a notification with its title and body', async () => {
    resolveWith([makeRow()]);

    render(<NotificationsList />);

    expect(await screen.findByText('Low stock: Ceramic Planter')).toBeInTheDocument();
    expect(screen.getByText('Only 3 units left in stock.')).toBeInTheDocument();
  });

  it('shows an error and lets the load be retried', async () => {
    fetchRows.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    resolveWith([makeRow()]);

    render(<NotificationsList />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't load/i);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Low stock: Ceramic Planter')).toBeInTheDocument();
  });
});

describe('read state', () => {
  it('opening an unread card marks it read', async () => {
    resolveWith([makeRow({ isRead: false })]);

    render(<NotificationsList />);

    const card = await screen.findByText('Low stock: Ceramic Planter');
    await userEvent.click(card);

    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith('n1');
    });
  });

  it('opening a card shows the full body in a detail panel', async () => {
    resolveWith([makeRow()]);

    render(<NotificationsList />);

    await userEvent.click(await screen.findByText('Low stock: Ceramic Planter'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Only 3 units left in stock.');
  });

  it('does not call markNotificationRead again for an already-read notification', async () => {
    resolveWith([makeRow({ isRead: true })]);

    render(<NotificationsList />);

    await userEvent.click(await screen.findByText('Low stock: Ceramic Planter'));

    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('keeps read and dismiss as separate native buttons', async () => {
    resolveWith([makeRow()]);
    render(<NotificationsList />);

    const open = await screen.findByRole('button', { name: /read "low stock/i });
    const dismiss = screen.getByRole('button', { name: /dismiss "low stock/i });

    expect(open).not.toContainElement(dismiss);
  });

  it('shows only safe internal admin destinations', async () => {
    resolveWith([makeRow({ link: '/admin/inventory' })]);
    render(<NotificationsList />);
    await userEvent.click(await screen.findByRole('button', { name: /read "low stock/i }));
    expect(await screen.findByRole('link', { name: /open the linked page/i })).toHaveAttribute(
      'href',
      '/admin/inventory',
    );
  });
});

describe('marking all as read', () => {
  it('is disabled when nothing is unread', async () => {
    resolveWith([makeRow({ isRead: true })]);

    render(<NotificationsList />);

    expect(await screen.findByRole('button', { name: /mark all as read/i })).toBeDisabled();
  });

  it('marks every row read', async () => {
    resolveWith([
      makeRow({ id: 'n1', isRead: false }),
      makeRow({ id: 'n2', title: 'Return request', body: 'RMA-0001 needs review.', isRead: false }),
    ]);
    markAllNotificationsRead.mockResolvedValue({ updated: 2 });

    render(<NotificationsList />);

    await screen.findByText('Low stock: Ceramic Planter');
    await userEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    await waitFor(() => {
      expect(markAllNotificationsRead).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDisabled();
  });
});

describe('dismissing a notification', () => {
  it('confirms through the REAL AlertDialog primitive, not a hand-rolled one', async () => {
    resolveWith([makeRow()]);

    render(<NotificationsList />);

    await screen.findByText('Low stock: Ceramic Planter');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    // Radix's AlertDialogContent carries this role natively — a
    // hand-rolled `<div role="alertdialog">` was the exact anti-pattern
    // caught and rewritten once already this session (see CLAUDE.md).
    const confirmDialog = await screen.findByRole('alertdialog');
    expect(confirmDialog).toHaveTextContent(/dismiss this notification/i);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    resolveWith([makeRow()]);

    render(<NotificationsList />);

    await screen.findByText('Low stock: Ceramic Planter');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    const confirmDialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Cancel' }).find((button) => confirmDialog.contains(button))!,
    );

    expect(deleteRow).not.toHaveBeenCalled();
    expect(screen.getByText('Low stock: Ceramic Planter')).toBeInTheDocument();
  });

  it('deletes and removes the row once confirmed', async () => {
    resolveWith([makeRow()]);
    deleteRow.mockResolvedValue({ row: makeRow(), action: 'deleted' });

    render(<NotificationsList />);

    await screen.findByText('Low stock: Ceramic Planter');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    const confirmDialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirmDialog).getByRole('button', { name: /^dismiss$/i }));

    await waitFor(() => {
      expect(deleteRow).toHaveBeenCalledWith('notifications', 'n1');
    });
    await waitFor(() => {
      expect(screen.queryByText('Low stock: Ceramic Planter')).not.toBeInTheDocument();
    });
  });
});

describe('search', () => {
  it('reloads with the typed search term, debounced', async () => {
    resolveWith([makeRow()]);

    render(<NotificationsList />);
    await screen.findByText('Low stock: Ceramic Planter');
    fetchRows.mockClear();
    resolveWith([]);

    await userEvent.type(screen.getByLabelText('Search'), 'planter');

    await waitFor(
      () => {
        expect(fetchRows).toHaveBeenCalledWith(
          'notifications',
          expect.objectContaining({ search: 'planter' }),
        );
      },
      { timeout: 2000 },
    );
  });

  it('writes the read-status filter to the URL and sends it to the server', async () => {
    resolveWith([makeRow()]);
    render(<NotificationsList />);
    await screen.findByText('Low stock: Ceramic Planter');
    fetchRows.mockClear();

    await userEvent.click(screen.getByRole('combobox', { name: /read status/i }));
    await userEvent.click(await screen.findByRole('option', { name: /^unread$/i }));

    await waitFor(() => {
      expect(fetchRows).toHaveBeenCalledWith(
        'notifications',
        expect.objectContaining({ filters: { isRead: 'false' } }),
      );
    });
  });
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    resolveWith([]);

    render(<NotificationsList />, { locale: 'ar' });

    expect(await screen.findByText('لا توجد إشعارات بعد.')).toBeInTheDocument();
  });
});
