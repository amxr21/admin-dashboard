import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { LoginForm } from '../login-form';
import { ApiError } from '@/lib/api';

/**
 * Login is the one screen every user meets, and the one most likely to be
 * met while something is already wrong. The error mapping is what these
 * mostly cover: each failure implies a DIFFERENT user action, and collapsing
 * them into one message makes a recoverable problem read as a broken app.
 */

const signIn = vi.fn();
const replace = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signIn: (...args: unknown[]) => signIn(...args) }),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => replace(...args) }),
}));

beforeEach(() => {
  vi.clearAllMocks();
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
    signIn.mockResolvedValue(undefined);
    render(<LoginForm />);

    await submit('admin@example.com', 'correct-password');

    expect(signIn).toHaveBeenCalledWith('admin@example.com', 'correct-password');
    // replace, not push — Back must not return to a passed login form.
    expect(replace).toHaveBeenCalledWith('/admin');
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
