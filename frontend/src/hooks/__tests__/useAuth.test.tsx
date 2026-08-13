import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { AuthProvider, useAuth } from '../useAuth';
import { readToken, writeSession } from '@/lib/auth-storage';

/**
 * B1.7 — signing out used to be entirely client-side (drop the token,
 * never tell the server), so there was no `auth.logout` audit event. This
 * pins `signOut`'s two properties together: it calls the real server
 * endpoint, AND it clears the local session regardless of whether that
 * call succeeds — a network blip on the way out must never strand someone
 * signed in on the screen, or block them from reaching the login page.
 */

const logout = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth-api', () => ({ logout }));

function Consumer() {
  const { user, signOut } = useAuth();
  return (
    <div>
      <p>{user ? `signed-in:${user.email}` : 'signed-out'}</p>
      <button onClick={signOut}>Sign out</button>
    </div>
  );
}

beforeEach(() => {
  logout.mockReset();
  writeSession('test-token', {
    id: 'u1',
    email: 'owner@example.test',
    name: 'Owner',
    role: 'OWNER',
  } as never);
});

afterEach(() => {
  window.localStorage.clear();
});

describe('signing out', () => {
  it('calls the server logout endpoint', async () => {
    logout.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await screen.findByText(/signed-in:/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it('clears the local session even when the server call fails', async () => {
    logout.mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await screen.findByText(/signed-in:/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
    expect(readToken()).toBeNull();
  });

  it('clears the local session without waiting for the server call to settle', async () => {
    // A logout() that never resolves must not block sign-out — the browser
    // is not still there to see a slow response by the time it would land.
    logout.mockReturnValue(new Promise(() => {}));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await screen.findByText(/signed-in:/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
  });
});
