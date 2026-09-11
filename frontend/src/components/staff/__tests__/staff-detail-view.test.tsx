import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import type { StaffDetail } from '@/lib/staff-api';
import { render, screen, waitFor, within } from '@/test/render';
import { StaffDetailView } from '../staff-detail-view';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

const api = vi.hoisted(() => ({
  fetchStaffDetail: vi.fn(),
  issueStaffResetToken: vi.fn(),
  revokeStaffSession: vi.fn(),
  signOutStaffEverywhere: vi.fn(),
  unlockStaff: vi.fn(),
}));

vi.mock('@/lib/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staff-api')>();
  return { ...actual, ...api };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'actor-1', email: 'admin@example.test', role: 'OWNER', name: 'Admin' },
  }),
}));

function makeDetail(overrides: Partial<StaffDetail> = {}): StaffDetail {
  return {
    staff: {
      id: 'staff-1',
      email: 'cashier@example.test',
      name: 'Mariam Saleh',
      phone: '+971501234567',
      role: 'CASHIER',
      isActive: true,
      accessExpiresAt: null,
      lastLoginAt: '2026-09-10T09:00:00.000Z',
      lastSeenAt: '2026-09-10T10:00:00.000Z',
      recentFailedLogins: 1,
      lockedUntil: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    profile: {
      values: { 'field-1': 'Evening' },
      jobTitle: 'Senior Cashier',
      department: 'Retail',
      manager: { id: 'manager-1', name: 'Omar Ali', email: 'omar@example.test' },
    },
    fields: [{ id: 'field-1', label: 'Preferred shift', type: 'text', required: false }],
    branches: [
      {
        role: 'CASHIER',
        assignedAt: '2026-08-01T00:00:00.000Z',
        branch: {
          id: 'branch-1',
          name: 'Downtown',
          code: 'DT',
          isActive: true,
          business: { id: 'business-1', name: 'Coffee House' },
        },
      },
    ],
    sessions: [
      {
        id: 'session-1',
        userAgent: 'Chrome on Windows',
        ip: '203.0.113.10',
        createdAt: '2026-09-10T09:00:00.000Z',
        lastSeenAt: '2026-09-10T10:00:00.000Z',
      },
    ],
    recentActivity: [
      {
        id: 'audit-1',
        action: 'sale.created',
        entity: 'sale',
        entityId: 'sale-1',
        actorId: 'staff-1',
        actorEmail: 'cashier@example.test',
        actorRole: 'CASHIER',
        outcome: 'SUCCESS',
        changes: null,
        createdAt: '2026-09-10T10:00:00.000Z',
      },
    ],
    capabilities: {
      edit: true,
      changeRole: true,
      changeLifecycle: true,
      manageCredentials: true,
      manageSessions: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchStaffDetail.mockResolvedValue(makeDetail());
});

describe('StaffDetailView', () => {
  it('composes the account, profile, branch, session, and activity in one workspace', async () => {
    render(<StaffDetailView staffId="staff-1" />);

    expect(await screen.findByRole('heading', { name: 'Mariam Saleh' })).toBeInTheDocument();
    expect(screen.getByText('Senior Cashier')).toBeInTheDocument();
    expect(screen.getByText('Evening')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Downtown' })).toHaveAttribute(
      'href',
      '/admin/branches/branch-1',
    );
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('sale.created')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View actions by this person' })).toHaveAttribute(
      'href',
      '/admin/audit?actorId=staff-1',
    );
  });

  it('uses server-provided capabilities to hide actions the actor cannot perform', async () => {
    api.fetchStaffDetail.mockResolvedValue(
      makeDetail({
        capabilities: {
          edit: true,
          changeRole: false,
          changeLifecycle: false,
          manageCredentials: false,
          manageSessions: false,
        },
      }),
    );

    render(<StaffDetailView staffId="staff-1" />);

    await screen.findByRole('heading', { name: 'Mariam Saleh' });
    expect(screen.getByRole('button', { name: 'Edit account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Password' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('confirms a targeted session revocation and refreshes the detail', async () => {
    api.revokeStaffSession.mockResolvedValue(undefined);
    render(<StaffDetailView staffId="staff-1" />);

    await screen.findByRole('heading', { name: 'Mariam Saleh' });
    await userEvent.click(screen.getByRole('button', { name: /^Sign out$/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Sign out$/ }));

    await waitFor(() =>
      expect(api.revokeStaffSession).toHaveBeenCalledWith('staff-1', 'session-1'),
    );
    await waitFor(() => expect(api.fetchStaffDetail).toHaveBeenCalledTimes(2));
  });

  it('shows an actionable forbidden state and retries without losing the route', async () => {
    api.fetchStaffDetail
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden'))
      .mockResolvedValueOnce(makeDetail());
    render(<StaffDetailView staffId="staff-1" />);

    expect(await screen.findByText('Staff details could not be loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));

    expect(await screen.findByRole('heading', { name: 'Mariam Saleh' })).toBeInTheDocument();
    expect(api.fetchStaffDetail).toHaveBeenNthCalledWith(2, 'staff-1');
  });

  it('keeps identifiers left-to-right while rendering Arabic in RTL', async () => {
    render(<StaffDetailView staffId="staff-1" />, { locale: 'ar' });

    expect(await screen.findByText('الحساب والوصول')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    for (const email of screen.getAllByText('cashier@example.test')) {
      expect(email).toHaveClass('force-ltr');
    }
    expect(screen.getByText('Chrome on Windows')).toHaveClass('force-ltr');
    expect(screen.getByRole('link', { name: 'العودة إلى الموظفين' }).firstElementChild).toHaveClass(
      'icon-directional',
    );
  });
});
