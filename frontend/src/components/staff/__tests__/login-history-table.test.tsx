import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginHistoryTable } from '@/components/staff/login-history-table';
import { render, screen } from '@/test/render';
import type { LoginHistoryEntry } from '@/lib/staff-api';

/**
 * The point of this page is that a REFUSED sign-in is visible and
 * distinguishable. These cover the two ways that could quietly break: a
 * failure rendering like a success, and a failed attempt's email being
 * presented as though someone had actually signed in.
 */

const fetchLoginHistory = vi.fn();

vi.mock('@/lib/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staff-api')>();
  return { ...actual, fetchLoginHistory: (...args: unknown[]) => fetchLoginHistory(...args) };
});

function entry(overrides: Partial<LoginHistoryEntry> = {}): LoginHistoryEntry {
  return {
    id: 'e1',
    action: 'auth.login.succeeded',
    actorId: 'u1',
    actorEmail: 'owner@example.test',
    actorRole: 'OWNER',
    outcome: 'SUCCESS',
    changes: null,
    ip: '203.0.113.4',
    userAgent: 'Mozilla/5.0',
    createdAt: '2026-09-05T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchLoginHistory.mockResolvedValue({ entries: [entry()], total: 1, page: 1, totalPages: 1 });
});

describe('sign-in history', () => {
  it('shows a successful sign-in with the actor who made it', async () => {
    render(<LoginHistoryTable />);

    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
    expect(screen.getByText(/signed in/i)).toBeInTheDocument();
  });

  it('labels a failed attempt as attempted, never as a signed-in identity', async () => {
    // A refused login has not proved who was trying, so the server records no
    // actor and puts the ATTEMPTED email in `changes`. Rendering that as a
    // confirmed identity would be a lie.
    fetchLoginHistory.mockResolvedValue({
      entries: [
        entry({
          id: 'e2',
          action: 'auth.login.failed',
          actorId: null,
          actorEmail: null,
          actorRole: null,
          outcome: 'DENIED',
          changes: { email: 'intruder@example.test', reason: 'INVALID_CREDENTIALS' },
        }),
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    render(<LoginHistoryTable />);

    expect(await screen.findByText('intruder@example.test')).toBeInTheDocument();
    expect(screen.getByText(/attempted/i)).toBeInTheDocument();
    // The server's own reason code, surfaced rather than reworded.
    expect(screen.getByText('INVALID_CREDENTIALS')).toBeInTheDocument();
  });

  it('says an IP was not recorded rather than rendering a blank', async () => {
    // `ip` is null where there is no trustworthy answer — never a guess — so
    // the absence has to read as deliberate, not as a rendering bug.
    fetchLoginHistory.mockResolvedValue({
      entries: [entry({ id: 'e3', ip: null })],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    render(<LoginHistoryTable />);

    expect(await screen.findByText(/not recorded/i)).toBeInTheDocument();
  });

  it('asks the API for failures only when that filter is chosen', async () => {
    render(<LoginHistoryTable />);
    await screen.findByText('owner@example.test');

    // The security-review query has to reach the SERVER — filtering a page of
    // 25 client-side would silently miss every failure on page 2.
    expect(fetchLoginHistory).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );
  });
});
