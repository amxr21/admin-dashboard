import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { MyAccountPanel } from '../my-account-panel';

/**
 * B2.4 — self-service profile + password. Before this panel, a non-admin
 * role (SUPPORT/FULFILLMENT/DEMO) had NO way to fix a typo in their own name
 * or change their own password — `PATCH /staff/:id` requires the `staff`
 * area, which those roles don't hold.
 *
 * The behaviour worth pinning: the save button's dirty-gating (never send a
 * no-op PATCH), the email field staying read-only (it IS the identity), and
 * the password-change flow's session handoff — the endpoint revokes every
 * token including the one making the request, so the fresh token from the
 * response MUST be applied before anything else, or the "success" toast
 * would be the last thing that works this session.
 */

const updateOwnProfile = vi.hoisted(() => vi.fn());
const changeOwnPassword = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-api')>();
  return { ...actual, updateOwnProfile, changeOwnPassword };
});

const updateCachedUser = vi.hoisted(() => vi.fn());
const applyNewToken = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({
  current: {
    id: 'u1',
    email: 'ali@example.test',
    name: 'Ali',
    role: 'SUPPORT' as const,
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser.current,
    updateCachedUser,
    applyNewToken,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.current = { id: 'u1', email: 'ali@example.test', name: 'Ali', role: 'SUPPORT' };
  updateOwnProfile.mockResolvedValue({
    id: 'u1',
    email: 'ali@example.test',
    name: 'New Name',
    phone: null,
    role: 'SUPPORT',
  });
  changeOwnPassword.mockResolvedValue({ token: 'fresh-token-123' });
});

describe('MyAccountPanel — profile', () => {
  it('keeps the email field read-only — it is the identity, not editable here', async () => {
    render(<MyAccountPanel />);

    const email = await screen.findByLabelText(/email/i);
    expect(email).toBeDisabled();
    expect(email).toHaveValue('ali@example.test');
  });

  it('disables Save until the name actually changes', async () => {
    render(<MyAccountPanel />);

    const save = await screen.findByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();

    const nameField = screen.getByLabelText(/^name$/i);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'New Name');

    expect(save).toBeEnabled();
  });

  it('saves only the changed name and updates the cached session', async () => {
    render(<MyAccountPanel />);

    const nameField = await screen.findByLabelText(/^name$/i);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'New Name');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateOwnProfile).toHaveBeenCalledWith({ name: 'New Name' }));
    // The list/topbar reads the cached user — a save that doesn't update it
    // would leave the old name showing until a full reload.
    expect(updateCachedUser).toHaveBeenCalledWith({ name: 'New Name' });
  });
});

describe('MyAccountPanel — password change', () => {
  it('requires the current password before the confirm button enables', async () => {
    render(<MyAccountPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /change password/i }));

    const confirm = screen.getByRole('button', { name: /^change password$/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/current password/i), 'old-pw');
    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-new-password');

    expect(confirm).toBeEnabled();
  });

  it('applies the fresh token BEFORE anything else, so the session survives its own change', async () => {
    const callOrder: string[] = [];
    applyNewToken.mockImplementation(() => callOrder.push('applyNewToken'));
    changeOwnPassword.mockImplementation(async () => {
      callOrder.push('changeOwnPassword');
      return { token: 'fresh-token-123' };
    });

    render(<MyAccountPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /change password/i }));

    await userEvent.type(screen.getByLabelText(/current password/i), 'old-pw');
    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-new-password');
    await userEvent.click(screen.getByRole('button', { name: /^change password$/i }));

    await waitFor(() => expect(applyNewToken).toHaveBeenCalledWith('fresh-token-123'));
    expect(callOrder).toEqual(['changeOwnPassword', 'applyNewToken']);
  });

  it('surfaces "current password is incorrect" verbatim from a 400', async () => {
    changeOwnPassword.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Current password is incorrect'),
    );

    render(<MyAccountPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /change password/i }));

    await userEvent.type(screen.getByLabelText(/current password/i), 'wrong');
    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-new-password');
    await userEvent.click(screen.getByRole('button', { name: /^change password$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
    // A rejected change must not touch the live session.
    expect(applyNewToken).not.toHaveBeenCalled();
  });
});
