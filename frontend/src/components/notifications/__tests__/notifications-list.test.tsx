import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, fetchRows, deleteRow };
});

vi.mock('@/lib/notifications-api', () => ({
  markAllNotificationsRead,
  markNotificationRead,
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
  fetchRows.mockResolvedValue({
    rows,
    total: rows.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
}

beforeEach(() => {
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
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    resolveWith([]);

    render(<NotificationsList />, { locale: 'ar' });

    expect(await screen.findByText('لا توجد إشعارات بعد.')).toBeInTheDocument();
  });
});
