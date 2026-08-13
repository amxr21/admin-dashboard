import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { StaffTable } from '../staff-table';
import type { StaffMember } from '@/lib/staff-api';

/**
 * B2.1 — the role/isActive filters.
 *
 * They were typed in `StaffListParams` and accepted by the backend, but the
 * table never sent them — the controls simply did not exist. These tests pin
 * the round trip (control → URL → request), the same discipline every other
 * filtered table in this app is held to, plus the one failure mode unique to
 * a hand-typed URL: `?role=WIZARD` must degrade to "all", not reach the API
 * as a 400 the user can't act on.
 *
 * Scoped to the filters only — this file had zero coverage before, and the
 * permission-enforcement surface (self-promotion, rank checks) is a separate,
 * larger piece of work than this session's task.
 */

const urlState = vi.hoisted(() => {
  let current = new URLSearchParams();
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    reset: () => {
      current = new URLSearchParams();
    },
    write: (href: string) => {
      current = new URLSearchParams(href.split('?')[1] ?? '');
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({
    push: (href: string) => urlState.write(href),
    replace: (href: string) => urlState.write(href),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/admin/staff',
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

const fetchStaff = vi.hoisted(() => vi.fn());

vi.mock('@/lib/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staff-api')>();
  return { ...actual, fetchStaff };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'me', email: 'owner@example.test', role: 'OWNER', name: 'Owner' },
  }),
}));

function makeStaff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 's1',
    email: 'a@example.test',
    name: 'Ali',
    phone: null,
    role: 'SUPPORT',
    isActive: true,
    accessExpiresAt: null,
    lastLoginAt: null,
    lockedUntil: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function resolveWith(staff: StaffMember[], total = staff.length) {
  fetchStaff.mockResolvedValue({
    staff,
    total,
    page: 1,
    pageSize: 20,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  });
}

beforeEach(() => {
  urlState.reset();
  fetchStaff.mockReset();
});

describe('StaffTable filters', () => {
  it('sends no role/isActive filter by default', async () => {
    resolveWith([makeStaff()]);

    render(<StaffTable />);

    await waitFor(() => expect(fetchStaff).toHaveBeenCalled());
    const params = fetchStaff.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('role');
    expect(params).not.toHaveProperty('isActive');
  });

  it('selecting a role writes it to the URL and sends it to the API', async () => {
    resolveWith([makeStaff()]);

    render(<StaffTable />);
    await waitFor(() => expect(fetchStaff).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('combobox', { name: /role/i }));
    await userEvent.click(await screen.findByRole('option', { name: /support/i }));

    await waitFor(() => expect(fetchStaff).toHaveBeenCalledTimes(2));
    const params = fetchStaff.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(params.role).toBe('SUPPORT');
    expect(urlState.get().get('role')).toBe('SUPPORT');
  });

  it('maps the status filter to a real isActive boolean, not a string', async () => {
    resolveWith([makeStaff()]);

    render(<StaffTable />);
    await waitFor(() => expect(fetchStaff).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('combobox', { name: /status/i }));
    await userEvent.click(await screen.findByRole('option', { name: /^inactive$/i }));

    await waitFor(() => expect(fetchStaff).toHaveBeenCalledTimes(2));
    const params = fetchStaff.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(params.isActive).toBe(false);
  });

  it('degrades a hand-typed unknown role to "all" instead of a doomed request', async () => {
    urlState.write('/admin/staff?role=WIZARD');
    resolveWith([makeStaff()]);

    render(<StaffTable />);

    await waitFor(() => expect(fetchStaff).toHaveBeenCalled());
    // An unknown enum value reaching the API is a 400 the user can't fix from
    // here — it must fall back to "no filter" instead.
    const params = fetchStaff.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('role');
  });

  it('shows a filtered-empty message, not the first-run "create staff" prompt', async () => {
    urlState.write('/admin/staff?role=DEVELOPER');
    resolveWith([], 0);

    render(<StaffTable />);

    // There is always at least one staff member — the person viewing this
    // page — so an empty result under a filter is never "no staff exist yet".
    await waitFor(() => expect(fetchStaff).toHaveBeenCalled());
    expect(await screen.findByText(/no.*(result|match)/i)).toBeInTheDocument();
  });

  it('clearing the role filter via its chip removes it from the request', async () => {
    urlState.write('/admin/staff?role=SUPPORT');
    resolveWith([makeStaff()]);

    render(<StaffTable />);
    await waitFor(() => expect(fetchStaff).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /support/i }));

    await waitFor(() => expect(fetchStaff).toHaveBeenCalledTimes(2));
    const params = fetchStaff.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('role');
  });
});

/**
 * B2.2 — `accessExpiresAt` is accepted and returned by the API, and silently
 * gates login (`auth.service.ts`), but was never shown anywhere. Blank for
 * the common case (no expiry) mirrors how `lastLogin` already treats "Never".
 */
describe('StaffTable access expiry column', () => {
  it('renders nothing for a member with no expiry set', async () => {
    resolveWith([makeStaff({ accessExpiresAt: null })]);

    render(<StaffTable />);

    await screen.findByText('Ali');
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  it('flags an already-expired date rather than rendering it identically to a future one', async () => {
    resolveWith([
      makeStaff({ name: 'Past Due', accessExpiresAt: '2020-01-01T23:59:59.999Z' }),
    ]);

    render(<StaffTable />);

    // This is silently blocking their login right now — it must not look the
    // same as a date that hasn't arrived yet.
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it('does not flag a future expiry date', async () => {
    resolveWith([
      makeStaff({ name: 'Future Ali', accessExpiresAt: '2099-01-01T23:59:59.999Z' }),
    ]);

    render(<StaffTable />);

    await screen.findByText('Future Ali');
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });
});

/**
 * B2.3 — "View activity" deep-links each row into the audit trail, scoped to
 * that person (`?actorId=`). Not gated by `editable`: reading what someone
 * did is a different permission than changing what they can do, and this
 * whole page is already staff-area-gated, so anyone here already has audit
 * access (see audit.route.ts).
 */
describe('StaffTable view activity link', () => {
  it('links to the audit trail scoped to that staff member, even when not editable', async () => {
    // A DEVELOPER outranks OWNER in this app's hierarchy, so the row is
    // correctly non-editable — the link must still be there.
    resolveWith([makeStaff({ id: 's9', role: 'DEVELOPER' })]);

    render(<StaffTable />);

    // Four row actions (edit, password, reset-token, history) exceed
    // RowActions' two-visible cap, so history sits behind "More actions".
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));

    const link = await screen.findByRole('menuitem', { name: /view history|activity/i });
    expect(link.closest('a')).toHaveAttribute('href', '/admin/audit?actorId=s9');
  });
});
