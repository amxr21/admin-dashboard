import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { ResetPasswordForm } from '../reset-password-form';
import { ApiError } from '@/lib/api';

/**
 * Redeeming a reset token is the only way back in for a locked-out user, so
 * the failure paths matter more than the happy one: a wrongly-swallowed error
 * here strands someone outside the app with no other route.
 *
 * The property most worth pinning is that this form does NOT enforce a
 * password length of its own — `security.minPasswordLength` is configurable
 * and lives behind an authenticated endpoint this page cannot read, so the
 * server is the only authority. A client-side floor added later would silently
 * drift from it.
 */

const redeemPasswordReset = vi.fn();
const replace = vi.fn();

vi.mock('@/lib/auth-api', () => ({
  redeemPasswordReset: (...args: unknown[]) => redeemPasswordReset(...args),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => replace(...args) }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function submit({
  token = 'ABC123TOKEN',
  password = 'a-long-enough-password',
  confirm = password,
}: { token?: string; password?: string; confirm?: string } = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/reset token/i), token);
  await user.type(screen.getByLabelText(/^new password$/i), password);
  await user.type(screen.getByLabelText(/confirm new password/i), confirm);
  await user.click(screen.getByRole('button', { name: /set password/i }));
  return user;
}

describe('successful redemption', () => {
  it('sends the token and password, then sends the user to sign in', async () => {
    redeemPasswordReset.mockResolvedValue(undefined);
    render(<ResetPasswordForm />);

    await submit({ token: 'TOK', password: 'brand-new-password' });

    expect(redeemPasswordReset).toHaveBeenCalledWith('TOK', 'brand-new-password');
    // Redemption revokes every session, so there is nothing to resume — and
    // `replace` keeps Back from returning to a spent token.
    expect(replace).toHaveBeenCalledWith('/login?reset=1');
  });

  it('trims the token, so a copy-paste with whitespace still works', async () => {
    redeemPasswordReset.mockResolvedValue(undefined);
    render(<ResetPasswordForm />);

    await submit({ token: '  TOK  ' });

    expect(redeemPasswordReset).toHaveBeenCalledWith('TOK', expect.any(String));
  });
});

describe('client-side guards', () => {
  it('refuses mismatched passwords without calling the API', async () => {
    render(<ResetPasswordForm />);

    await submit({ password: 'password-one', confirm: 'password-two' });

    expect(redeemPasswordReset).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
  });

  it('does NOT impose its own length floor — the server owns the policy', async () => {
    redeemPasswordReset.mockResolvedValue(undefined);
    render(<ResetPasswordForm />);

    // Deliberately shorter than the 12 that staff-password-panel hardcodes.
    await submit({ password: 'short' });

    // The request goes through; if the policy refuses it, the server says so.
    expect(redeemPasswordReset).toHaveBeenCalledWith(expect.any(String), 'short');
  });
});

describe('error mapping', () => {
  it("passes the server's 400 through verbatim rather than guessing why", async () => {
    // Covers both an invalid token and a too-weak password: only the server
    // knows which, and its message is already written for a human.
    redeemPasswordReset.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Password must be at least 14 characters'),
    );
    render(<ResetPasswordForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /at least 14 characters/i,
    );
  });

  it('keeps the token but clears the passwords after a failure', async () => {
    redeemPasswordReset.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Password is too weak'),
    );
    render(<ResetPasswordForm />);

    await submit({ token: 'KEEPME' });
    await screen.findByRole('alert');

    // Retyping a handed-over token after a weak-password rejection is pure
    // friction — the token was never the problem.
    expect(screen.getByLabelText(/reset token/i)).toHaveValue('KEEPME');
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
  });

  it('reports rate limiting distinctly on 429', async () => {
    redeemPasswordReset.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Slow down'));
    render(<ResetPasswordForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('treats a non-ApiError rejection as a network failure', async () => {
    redeemPasswordReset.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ResetPasswordForm />);

    await submit();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
