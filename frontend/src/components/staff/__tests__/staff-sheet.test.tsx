import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { StaffSheet } from '../staff-sheet';
import type { StaffMember } from '@/lib/staff-api';

/**
 * B2.2 — `accessExpiresAt` was accepted by the API and typed on `StaffMember`,
 * but there was no control anywhere to set it, and `UpdateStaffInput` didn't
 * even have the field. These pin the part that matters if it regresses: the
 * self-lockout guard (never send your own expiry — same rule as role and
 * isActive) and the end-of-day UTC conversion the date picker relies on,
 * since a plain calendar date sent bare would be ambiguous about the moment
 * it takes effect.
 */

const { createStaff, fetchBranches, updateStaff } = vi.hoisted(() => ({
  createStaff: vi.fn(),
  fetchBranches: vi.fn(),
  updateStaff: vi.fn(),
}));

vi.mock('@/lib/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staff-api')>();
  return { ...actual, createStaff, updateStaff };
});

vi.mock('@/lib/branches-api', () => ({ fetchBranches }));

function makeStaff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 's1',
    email: 'a@example.test',
    name: 'Ali',
    phone: null,
    role: 'SUPPORT',
    isActive: true,
    accessExpiresAt: null,
    lastLoginAt: null,
    lastSeenAt: null,
    recentFailedLogins: 0,
    lockedUntil: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  createStaff.mockReset();
  fetchBranches.mockReset();
  updateStaff.mockReset();
  createStaff.mockResolvedValue(makeStaff());
  fetchBranches.mockResolvedValue([
    {
      id: 'branch-1',
      name: 'Marina',
      code: 'MAR',
      city: 'Dubai',
      isSellingPoint: true,
      isDefault: true,
      businessId: 'business-1',
      businessName: 'Demo Store',
    },
  ]);
  updateStaff.mockResolvedValue(makeStaff());
});

describe('StaffSheet creation', () => {
  it('assigns a new branch-scoped employee to the selected branch', async () => {
    render(
      <StaffSheet
        member={null}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByRole('combobox', { name: /branch/i })).toHaveTextContent(
      /marina/i,
    );
    await userEvent.type(screen.getByLabelText(/^email$/i), 'new@example.test');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'a-sufficiently-long-password');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(createStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.test',
          role: 'SUPPORT',
          branchId: 'branch-1',
        }),
      ),
    );
  });

  it('shows a retry action when branches cannot be loaded', async () => {
    fetchBranches.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);

    render(
      <StaffSheet
        member={null}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const retry = await screen.findByRole('button', { name: /retry loading branches/i });
    await userEvent.click(retry);

    await waitFor(() => expect(fetchBranches).toHaveBeenCalledTimes(2));
  });

  it('labels the branch picker in Arabic and keeps the selected branch readable', async () => {
    render(
      <StaffSheet
        member={null}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      { locale: 'ar' },
    );

    expect(await screen.findByRole('combobox', { name: /الفرع/ })).toHaveTextContent(
      /marina/i,
    );
  });
});

describe('StaffSheet access expiry', () => {
  it('offers no expiry control when editing your own account', async () => {
    render(
      <StaffSheet
        member={makeStaff({ id: 'me' })}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await screen.findByText('a@example.test', { exact: false }).catch(() => undefined);
    // Same guard as role and isActive: setting your own expiry risks the same
    // self-lockout, and the server has no special case exempting yourself.
    expect(screen.queryByLabelText(/access expires/i)).not.toBeInTheDocument();
  });

  it('sends null, not an empty string, when the expiry field is left blank', async () => {
    render(
      <StaffSheet
        member={makeStaff()}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateStaff).toHaveBeenCalled());
    const payload = updateStaff.mock.calls[0]?.[1] as Record<string, unknown>;
    // `undefined` would mean "don't touch it"; the field must be able to
    // CLEAR an existing expiry, which only a real `null` does server-side.
    expect(payload.accessExpiresAt).toBeNull();
  });

  it('converts the picked calendar date to end-of-day UTC', async () => {
    render(
      <StaffSheet
        member={makeStaff()}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const trigger = await screen.findByLabelText(/access expires/i);
    await userEvent.click(trigger);

    const day15 = await screen.findByRole('gridcell', { name: '15' });
    await userEvent.click(day15.querySelector('button') ?? day15);

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateStaff).toHaveBeenCalled());
    const payload = updateStaff.mock.calls[0]?.[1] as Record<string, unknown>;
    // Whichever month the picker defaulted to, the day must be the 15th and
    // the time must be the inclusive end of that day, not local midnight.
    expect(payload.accessExpiresAt).toMatch(/-15T23:59:59\.999Z$/);
  });

  it('preloads the existing expiry as a calendar date, not a raw ISO string', async () => {
    render(
      <StaffSheet
        member={makeStaff({ accessExpiresAt: '2030-06-15T23:59:59.999Z' })}
        actorRole="OWNER"
        actorId="me"
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const trigger = await screen.findByLabelText(/access expires/i);
    // The picker renders a localized label, not the ISO string — this just
    // confirms it parsed the stored value at all rather than showing "Choose".
    expect(trigger).not.toHaveTextContent(/choose/i);
  });
});
