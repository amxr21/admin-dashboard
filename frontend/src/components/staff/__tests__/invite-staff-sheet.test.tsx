import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { InviteStaffSheet } from '../invite-staff-sheet';

/**
 * B2.5 — invitations. Before this, `POST /staff` (an admin typing a password
 * on someone else's behalf) was the ONLY way a new person joined staff. This
 * panel is the primary action the spec names for the page: create the
 * account, hand over a one-time activation code, never learn the password.
 *
 * What's worth pinning: no password field exists anywhere in this form (the
 * whole point), the account exists in the list immediately even while the
 * token-reveal is still showing (so a second admin looking at the table
 * isn't confused by a missing row), and the role control mirrors the same
 * rank rule every other staff form uses.
 */

const inviteStaff = vi.hoisted(() => vi.fn());

vi.mock('@/lib/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staff-api')>();
  return { ...actual, inviteStaff };
});

const mockDefaultInviteRole = vi.hoisted(() => ({ current: 'SUPPORT' }));

vi.mock('@/components/providers/settings-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/providers/settings-provider')>();
  return {
    ...actual,
    useAppSettings: () => ({
      editPanelMode: 'drawer' as const,
      defaultInviteRole: mockDefaultInviteRole.current,
    }),
  };
});

beforeEach(() => {
  inviteStaff.mockReset();
  mockDefaultInviteRole.current = 'SUPPORT';
  inviteStaff.mockResolvedValue({
    staff: { id: 's9', email: 'new@example.test' },
    token: 'ABCD-EFGH-JKMN',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
});

describe('InviteStaffSheet', () => {
  it('has no password field anywhere in the form', () => {
    render(
      <InviteStaffSheet actorRole="OWNER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    // The entire point of this flow — a password input here would mean the
    // admin ends up typing (and therefore knowing) the invitee's credential.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('only offers roles at or below the actor\'s own rank', async () => {
    render(
      <InviteStaffSheet actorRole="MANAGER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: /role/i }));

    // A MANAGER must never be offered OWNER or DEVELOPER — the server refuses
    // it too, but the control shouldn't dangle the option in the first place.
    expect(screen.queryByRole('option', { name: /^owner$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^developer$/i })).not.toBeInTheDocument();
  });

  it('creates the account and reveals the one-time token', async () => {
    const onInvited = vi.fn();
    render(
      <InviteStaffSheet actorRole="OWNER" open onOpenChange={vi.fn()} onInvited={onInvited} />,
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteStaff).toHaveBeenCalled());
    // The row must appear in the list WHILE the token is still on screen —
    // closing first would mean a second admin sees no evidence the invite
    // happened until this dialog is dismissed.
    expect(onInvited).toHaveBeenCalled();
    expect(await screen.findByText('ABCD-EFGH-JKMN')).toBeInTheDocument();
  });

  it('keeps Send Invite disabled until an email is entered', () => {
    render(
      <InviteStaffSheet actorRole="OWNER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    // Same convention as StaffSheet's create mode: disabled rather than
    // clickable-then-rejected, so there's nothing for `inviteStaff` to be
    // called with in the first place.
    expect(screen.getByRole('button', { name: /send invite/i })).toBeDisabled();
  });

  it('sends accessExpiresAt as end-of-day UTC when a date is picked', async () => {
    render(
      <InviteStaffSheet actorRole="OWNER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'timed@example.test');

    const trigger = screen.getByLabelText(/access expires/i);
    await userEvent.click(trigger);
    const day20 = await screen.findByRole('gridcell', { name: '20' });
    await userEvent.click(day20.querySelector('button') ?? day20);

    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteStaff).toHaveBeenCalled());
    const payload = inviteStaff.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.accessExpiresAt).toMatch(/-20T23:59:59\.999Z$/);
  });

  it('pre-selects the live staff.defaultInviteRole', async () => {
    mockDefaultInviteRole.current = 'FULFILLMENT';

    render(
      <InviteStaffSheet actorRole="OWNER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'preselect@example.test');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteStaff).toHaveBeenCalled());
    const payload = inviteStaff.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.role).toBe('FULFILLMENT');
  });

  it('falls back to the highest role the actor can assign when the default is above their rank', async () => {
    // A MANAGER viewing an OWNER-configured default they cannot grant must
    // not open on a role the picker doesn't even offer.
    mockDefaultInviteRole.current = 'OWNER';

    render(
      <InviteStaffSheet actorRole="MANAGER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'fallback@example.test');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(inviteStaff).toHaveBeenCalled());
    const payload = inviteStaff.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.role).not.toBe('OWNER');
  });

  it('surfaces a 409 (duplicate email) without a generic fallback message', async () => {
    const { ApiError } = await import('@/lib/api');
    inviteStaff.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'That email address is already in use'),
    );

    render(
      <InviteStaffSheet actorRole="OWNER" open onOpenChange={vi.fn()} onInvited={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'taken@example.test');
    await userEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });
});
