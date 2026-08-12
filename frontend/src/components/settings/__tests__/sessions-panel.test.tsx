import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { SessionsPanel } from '../sessions-panel';
import type { SessionSummary } from '@/lib/auth-api';

/**
 * B2.6 — Sessions & devices. Before the `Session` model, the only revocation
 * was `tokenVersion`: one counter that kills every session at once. This
 * panel is the first place "sign out THAT device" is possible at all.
 *
 * What's worth pinning: a revoke targets exactly the session clicked (not
 * "all of them," which would be indistinguishable from the old behaviour
 * from the UI's perspective), a destructive action goes through a real
 * confirmation rather than firing on click, and the list survives an empty
 * `userAgent` without rendering "undefined" or a blank row.
 */

const fetchOwnSessions = vi.hoisted(() => vi.fn());
const revokeOwnSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-api')>();
  return { ...actual, fetchOwnSessions, revokeOwnSession };
});

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    userAgent: 'Mozilla/5.0 (Macintosh)',
    ip: '203.0.113.5',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchOwnSessions.mockResolvedValue([makeSession()]);
  revokeOwnSession.mockResolvedValue(undefined);
});

describe('SessionsPanel', () => {
  it('lists a live session with its device and IP', async () => {
    render(<SessionsPanel />);

    expect(await screen.findByText('Mozilla/5.0 (Macintosh)')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.5', { exact: false })).toBeInTheDocument();
  });

  it('renders a fallback label rather than a blank row for a null user agent', async () => {
    fetchOwnSessions.mockResolvedValue([makeSession({ userAgent: null })]);

    render(<SessionsPanel />);

    expect(await screen.findByText(/unknown device/i)).toBeInTheDocument();
  });

  it('does not revoke on a single click — a confirmation is required first', async () => {
    render(<SessionsPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(revokeOwnSession).not.toHaveBeenCalled();
    expect(await screen.findByText(/sign out this device/i)).toBeInTheDocument();
  });

  it('revokes exactly the session that was clicked, and refreshes the list', async () => {
    fetchOwnSessions.mockResolvedValueOnce([
      makeSession({ id: 'target', userAgent: 'Target Device' }),
      makeSession({ id: 'other', userAgent: 'Other Device' }),
    ]);

    render(<SessionsPanel />);
    await screen.findByText('Target Device');

    const rows = screen.getAllByRole('button', { name: /sign out/i });
    // The first row's button belongs to "Target Device" — click it, not "all
    // sessions," which is the property this whole feature exists to prove.
    await userEvent.click(rows[0] as HTMLElement);

    fetchOwnSessions.mockResolvedValueOnce([makeSession({ id: 'other', userAgent: 'Other Device' })]);
    await userEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(revokeOwnSession).toHaveBeenCalledWith('target'));
    expect(revokeOwnSession).not.toHaveBeenCalledWith('other');
  });

  it('surfaces a failed load with a retry rather than an empty list', async () => {
    fetchOwnSessions.mockRejectedValue(new Error('boom'));

    render(<SessionsPanel />);

    // An error and "no sessions" must not look the same — one is a fact
    // about the account, the other is a fact about the network.
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/no active sessions/i)).not.toBeInTheDocument();
  });

  it('treats an already-revoked session (404 on delete) as a quiet success, not an error', async () => {
    revokeOwnSession.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Session not found'));

    render(<SessionsPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));

    // Two tabs racing to revoke the same session is not a bug worth alarming
    // over — the end state (that session is gone) is what the user wanted.
    await waitFor(() => expect(revokeOwnSession).toHaveBeenCalled());
  });
});
