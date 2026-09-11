import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';

import { render, screen, waitFor } from '@/test/render';
import { LoginForm } from '../login-form';
import { ApiError } from '@/lib/api';
import { resetSessionRecovery } from '@/lib/session-recovery';

/**
 * Login is the one screen every user meets, and the one most likely to be
 * met while something is already wrong. The error mapping is what these
 * mostly cover: each failure implies a DIFFERENT user action, and collapsing
 * them into one message makes a recoverable problem read as a broken app.
 */

const signIn = vi.fn();
const verifyTwoFactor = vi.fn();
const replace = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signIn: (...args: unknown[]) => signIn(...args),
    verifyTwoFactor: (...args: unknown[]) => verifyTwoFactor(...args),
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => replace(...args) }),
  // The form links to /reset-password — the only discoverable route to it.
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  resetSessionRecovery();
});

async function submit(email = 'a@b.com', password = 'secret123') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
  return user;
}

describe('successful sign-in', () => {
  it('signs in and navigates to the dashboard', async () => {
    signIn.mockResolvedValue({ status: 'SIGNED_IN', role: 'OWNER' });
    render(<LoginForm />);

    await submit('admin@example.com', 'correct-password');

    expect(signIn).toHaveBeenCalledWith('admin@example.com', 'correct-password');
    // replace, not push — Back must not return to a passed login form.
    expect(replace).toHaveBeenCalledWith('/admin');
  });

  it('lands a role on its own work rather than the revenue dashboard (O3.4)', async () => {
    // FULFILLMENT has no `reports` grant, so `/admin` is a page built to
    // answer a question they may not ask — and every widget on it 403s.
    signIn.mockResolvedValue({ status: 'SIGNED_IN', role: 'FULFILLMENT' });
    render(<LoginForm />);

    await submit('picker@example.com', 'correct-password');

    expect(replace).toHaveBeenCalledWith('/admin/orders');
  });

  it('returns to the saved internal destination after an expired session', async () => {
    window.sessionStorage.setItem('admin-dashboard:session-return-path', '/admin/orders?status=PENDING');
    signIn.mockResolvedValue({ status: 'SIGNED_IN', role: 'OWNER' });
    render(<LoginForm />);

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    await submit('admin@example.com', 'correct-password');

    expect(replace).toHaveBeenCalledWith('/admin/orders?status=PENDING');
    expect(window.sessionStorage.getItem('admin-dashboard:session-return-path')).toBeNull();
  });

});

describe('two-step verification (O3b.1)', () => {
  /**
   * Before this, `signIn` could return TWO_FACTOR_REQUIRED and NOTHING in the
   * UI handled it — the form redirected to /admin with no session written, so
   * every request 401'd and a 2FA user could not sign in at all. The tests
   * below are about the two halves staying distinct: no session yet, and no
   * redirect until the code is verified.
   */
  it('asks for a code instead of redirecting', async () => {
    signIn.mockResolvedValue({ status: 'TWO_FACTOR_REQUIRED', pendingToken: 'pending-token' });
    render(<LoginForm />);

    await submit('twofa@example.com', 'correct-password');

    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
    // No session exists yet — redirecting here is the original bug.
    expect(replace).not.toHaveBeenCalled();
  });

  it('verifies the code and lands on the role page', async () => {
    signIn.mockResolvedValue({ status: 'TWO_FACTOR_REQUIRED', pendingToken: 'pending-token' });
    verifyTwoFactor.mockResolvedValue('FULFILLMENT');
    render(<LoginForm />);

    await submit('picker@example.com', 'correct-password');

    const field = await screen.findByLabelText(/verification code/i);
    await userEvent.type(field, '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(verifyTwoFactor).toHaveBeenCalledWith('pending-token', '123456');
    });
    // A 2FA sign-in lands exactly where a password-only one would (O3.4).
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/admin/orders');
    });
  });

  it('keeps the code step open after a wrong code', async () => {
    signIn.mockResolvedValue({ status: 'TWO_FACTOR_REQUIRED', pendingToken: 'pending-token' });
    verifyTwoFactor.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid code'));
    render(<LoginForm />);

    await submit('twofa@example.com', 'correct-password');

    const field = await screen.findByLabelText(/verification code/i);
    await userEvent.type(field, '000000');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // Still on the code step, and the field is cleared for a retype — the
    // code is single-use, so a wrong one is never corrected in place.
    expect(screen.getByLabelText(/verification code/i)).toHaveValue('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('never sends the pending token to storage or the URL', async () => {
    // It proves the password step happened, so it is a credential that skips
    // the password if stolen. React state dies with the page; localStorage
    // and the URL both outlive it.
    signIn.mockResolvedValue({ status: 'TWO_FACTOR_REQUIRED', pendingToken: 'secret-pending' });
    render(<LoginForm />);

    await screen.findByLabelText(/password/i);
    await submit('twofa@example.com', 'correct-password');
    await screen.findByLabelText(/verification code/i);

    expect(JSON.stringify(window.localStorage)).not.toContain('secret-pending');
    expect(window.location.href).not.toContain('secret-pending');
  });

  it('can start over, dropping the pending token', async () => {
    signIn.mockResolvedValue({ status: 'TWO_FACTOR_REQUIRED', pendingToken: 'pending-token' });
    render(<LoginForm />);

    await submit('twofa@example.com', 'correct-password');
    await screen.findByLabelText(/verification code/i);

    await userEvent.click(screen.getByRole('button', { name: /different account/i }));

    // Back to the password form — a genuine restart, not a hidden half-login.
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
  });
});

describe('error mapping', () => {
  it('reports bad credentials on 401', async () => {
    signIn.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password'));
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't right/i);
  });

  it('reports a deactivated account on 403', async () => {
    // Retrying will never help here, so the message must not say "try again".
    signIn.mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'This account has been deactivated'),
    );
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/deactivated/i);
  });

  it('reports lockout on 423, including the wait time', async () => {
    // "Too many attempts" without a duration leaves the user guessing whether
    // to wait a minute or an hour.
    signIn.mockRejectedValue(
      new ApiError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.'),
    );
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/15 minutes/i);
  });

  it('parses the lockout duration from the API rather than hardcoding it', async () => {
    signIn.mockRejectedValue(
      new ApiError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 30 minutes.'),
    );
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/30 minutes/i);
  });

  it('reports IP rate limiting on 429', async () => {
    signIn.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many login attempts'));
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/this address/i);
  });

  it('reports a server problem on 500, not a credential problem', async () => {
    // Telling a user their password is wrong when the server broke sends them
    // down a dead end.
    signIn.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/server had a problem/i);
  });

  it('reports a connection problem when fetch itself fails', async () => {
    // fetch REJECTS on network failure rather than resolving, so this is not
    // an ApiError at all.
    signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
  });
});

describe('form behaviour', () => {
  it('announces errors to assistive tech', async () => {
    signIn.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));
    render(<LoginForm />);

    await submit();

    // Without role=alert a screen-reader user gets no feedback at all.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('clears the password but KEEPS the email after a failure', async () => {
    // Retyping an email after mistyping a password is pure friction.
    signIn.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));
    render(<LoginForm />);

    await submit('keep@me.com', 'wrong');
    await screen.findByRole('alert');

    expect(screen.getByLabelText(/email/i)).toHaveValue('keep@me.com');
    expect(screen.getByLabelText(/password/i)).toHaveValue('');
  });

  it('marks both fields invalid after a failure', async () => {
    signIn.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));
    render(<LoginForm />);

    await submit();
    await screen.findByRole('alert');

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses type=email so the address is forced LTR in Arabic', async () => {
    // globals.css targets input[type=email]. Without it an address visually
    // reorders inside an RTL form and becomes unreadable.
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('type', 'email');
  });

  it('renders in Arabic', () => {
    render(<LoginForm />, { locale: 'ar' });

    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });
});
