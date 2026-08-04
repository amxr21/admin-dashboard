import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';

import { render, screen, waitFor } from '@/test/render';
import { NotificationsBell } from '../notifications-bell';
import type { ResourceRow } from '@/lib/resource-api';

/**
 * The top-bar bell: a PREVIEW of unread notifications, not a second
 * implementation of the `/admin/notifications` list. It reads through the
 * same generic `fetchRows('notifications', ...)` client that page uses, and
 * "mark all as read" is the one bulk action the generic engine has no
 * vocabulary for (see notifications.route.ts) — this pins that it's wired to
 * the real bespoke endpoint.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const fetchRows = vi.hoisted(() => vi.fn());
const markAllNotificationsRead = vi.hoisted(() => vi.fn());

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, fetchRows };
});

vi.mock('@/lib/notifications-api', () => ({ markAllNotificationsRead }));

function makeRow(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'n1',
    title: 'Low stock: Ceramic Planter',
    isRead: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

/** The count call and the preview call are the same client function with
 *  different params — route by whether `filters.isRead` is present, which
 *  both real calls set, vs. by `pageSize` (1 for the count, 5 for the
 *  preview). */
function mockCountAndPreview(total: number, previewRows: ResourceRow[]) {
  fetchRows.mockImplementation((_resource: string, params: { pageSize?: number }) => {
    if (params.pageSize === 1) {
      return Promise.resolve({ rows: [], total, page: 1, pageSize: 1, totalPages: 1 });
    }
    return Promise.resolve({
      rows: previewRows,
      total: previewRows.length,
      page: 1,
      pageSize: 5,
      totalPages: 1,
    });
  });
}

beforeEach(() => {
  fetchRows.mockReset();
  markAllNotificationsRead.mockReset();
});

describe('the unread badge', () => {
  it('shows no badge when nothing is unread', async () => {
    mockCountAndPreview(0, []);

    render(<NotificationsBell />);

    await waitFor(() => expect(fetchRows).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows the unread count', async () => {
    mockCountAndPreview(3, [makeRow()]);

    render(<NotificationsBell />);

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('caps the displayed count above 99', async () => {
    mockCountAndPreview(140, [makeRow()]);

    render(<NotificationsBell />);

    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('does not break the shell when the count fails to load', async () => {
    fetchRows.mockRejectedValue(new Error('network down'));

    render(<NotificationsBell />);

    // No badge, but the bell itself must still render.
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

describe('the preview dropdown', () => {
  it('shows recent unread rows once opened', async () => {
    mockCountAndPreview(1, [makeRow()]);

    render(<NotificationsBell />);

    await userEvent.click(await screen.findByRole('button', { name: /unread notification/i }));

    expect(await screen.findByText('Low stock: Ceramic Planter')).toBeInTheDocument();
  });

  it('shows an empty message when nothing is unread', async () => {
    mockCountAndPreview(0, []);

    render(<NotificationsBell />);

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText('Nothing unread.')).toBeInTheDocument();
  });

  it('marks everything read and clears the preview', async () => {
    mockCountAndPreview(1, [makeRow()]);
    markAllNotificationsRead.mockResolvedValue({ updated: 1 });

    render(<NotificationsBell />);

    await userEvent.click(await screen.findByRole('button', { name: /unread notification/i }));
    await screen.findByText('Low stock: Ceramic Planter');

    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => {
      expect(markAllNotificationsRead).toHaveBeenCalled();
    });
    expect(await screen.findByText('Nothing unread.')).toBeInTheDocument();
  });

  it('links "View all" to the full notifications page', async () => {
    mockCountAndPreview(1, [makeRow()]);

    render(<NotificationsBell />);

    await userEvent.click(await screen.findByRole('button', { name: /unread notification/i }));

    expect(await screen.findByRole('link', { name: /view all notifications/i })).toHaveAttribute(
      'href',
      '/admin/notifications',
    );
  });
});
