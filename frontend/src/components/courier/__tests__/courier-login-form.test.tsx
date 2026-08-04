import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { CourierLoginForm } from '../courier-login-form';
import { ApiError } from '@/lib/api';

/**
 * Courier sign-in is a SEPARATE auth surface from staff `/login` — its own
 * endpoint, its own session storage. These tests pin that a successful code
 * writes the COURIER session (never the staff one) and that a rejected code
 * shows the same generic message the backend deliberately returns for both
 * "unknown code" and "suspended courier" (see courier.route.ts) — telling
 * them apart would be an enumeration oracle.
 */

const courierLogin = vi.hoisted(() => vi.fn());
const writeCourierSession = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

vi.mock('@/lib/courier-api', () => ({ courierLogin }));
vi.mock('@/lib/courier-auth-storage', () => ({ writeCourierSession }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function submit(code = 'ABCD-1234-EFGH') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/access code/i), code);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
  return user;
}

describe('successful sign-in', () => {
  it('stores the courier session and navigates to the dashboard', async () => {
    courierLogin.mockResolvedValue({
      token: 'courier-jwt',
      courier: { id: 'd1', name: 'Sami' },
    });

    render(<CourierLoginForm />);

    await submit('ABCD-1234-EFGH');

    expect(courierLogin).toHaveBeenCalledWith('ABCD-1234-EFGH');
    expect(writeCourierSession).toHaveBeenCalledWith('courier-jwt', {
      id: 'd1',
      name: 'Sami',
    });
    expect(replace).toHaveBeenCalledWith('/courier');
  });
});

describe('error mapping', () => {
  it('shows the same generic message for a wrong code as for a suspended courier', async () => {
    courierLogin.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'anything'));

    render(<CourierLoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't right/i);
    expect(writeCourierSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('reports rate limiting on 429 rather than "wrong code"', async () => {
    courierLogin.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down'));

    render(<CourierLoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('reports a connection problem when fetch itself fails', async () => {
    courierLogin.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<CourierLoginForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
  });

  it('clears the code after a failed attempt', async () => {
    courierLogin.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));

    render(<CourierLoginForm />);

    await submit();
    await screen.findByRole('alert');

    expect(screen.getByLabelText(/access code/i)).toHaveValue('');
  });
});

describe('localisation', () => {
  it('renders in Arabic', () => {
    render(<CourierLoginForm />, { locale: 'ar' });

    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });
});
