import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ForgotPasswordForm } from '../forgot-password-form';
import { ApiError } from '@/lib/api';

/**
 * The property worth pinning here is NEUTRALITY, not the happy path.
 *
 * The backend answers 200 for a known and an unknown address alike so that
 * this endpoint cannot be used to enumerate who works here. That guarantee is
 * only as good as the UI on top of it: a well-meaning "no account found"
 * message added later would rebuild the oracle client-side while every
 * backend test stayed green. These tests fail if that happens.
 */

const requestPasswordReset = vi.fn();

vi.mock('@/lib/auth-api', () => ({
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requestPasswordReset.mockResolvedValue(undefined);
});

async function submit(email = 'staff@example.com') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email address/i), email);
  await user.click(screen.getByRole('button', { name: /send reset code/i }));
  return user;
}

describe('ForgotPasswordForm', () => {
  it('sends the normalized address, so the same account cannot miss its own code', async () => {
    render(<ForgotPasswordForm />);
    await submit('  Staff@Example.COM  ');

    expect(requestPasswordReset).toHaveBeenCalledWith('staff@example.com');
  });

  it('shows a confirmation that does not claim the address was found', async () => {
    render(<ForgotPasswordForm />);
    await submit();

    const status = await screen.findByRole('status');
    // Conditional phrasing ("if that address has an account") is the whole
    // point — an unconditional "sent" would confirm the account exists.
    expect(status.textContent).toMatch(/if that address has an account/i);
  });

  it('replaces the form on success, leaving nothing to resubmit for a different answer', async () => {
    render(<ForgotPasswordForm />);
    await submit();

    await screen.findByRole('status');
    expect(screen.queryByRole('button', { name: /send reset code/i })).toBeNull();
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
  });

  it('rejects a malformed address before spending a rate-limited attempt', async () => {
    render(<ForgotPasswordForm />);
    await submit('not-an-email');

    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email address/i);
  });

  it('names a rate limit, the one failure the person can act on', async () => {
    requestPasswordReset.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down'));
    render(<ForgotPasswordForm />);
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not claim success when the request fails outright', async () => {
    requestPasswordReset.mockRejectedValue(new ApiError(500, 'SERVER', 'boom'));
    render(<ForgotPasswordForm />);
    await submit();

    // A failed send must leave the form usable — telling someone to check an
    // inbox nothing was sent to strands them with no other route back in.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /send reset code/i })).toBeInTheDocument();
  });
});
