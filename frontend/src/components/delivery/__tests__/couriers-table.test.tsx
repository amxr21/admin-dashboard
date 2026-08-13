import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/sonner';
import { CouriersTable } from '../couriers-table';
import type { Courier } from '@/lib/delivery-api';

/**
 * Couriers, and the credential each one signs in with.
 *
 * The tests that carry this screen are about the ACCESS CODE. It exists in
 * readable form exactly once, so the failure modes are: showing it where it
 * shouldn't be, losing it silently, or implying it can be read back.
 */

/**
 * A STATEFUL stand-in for the URL bar — same shape as orders-table.test.tsx's,
 * needed for the same reason: the global `vitest.setup.ts` mock of
 * `next/navigation` returns a fresh, empty `URLSearchParams` on every call
 * and a `router.replace` that does nothing, so a status filter applied via
 * `useUrlState` would write the value and then read back "no filter" —
 * exactly the round trip B4.4's status filter depends on.
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
  usePathname: () => '/admin/delivery',
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

const fetchCouriers = vi.hoisted(() => vi.fn());
const issueAccessCode = vi.hoisted(() => vi.fn());
const revokeAccessCode = vi.hoisted(() => vi.fn());

vi.mock('@/lib/delivery-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/delivery-api')>();
  return { ...actual, fetchCouriers, issueAccessCode, revokeAccessCode };
});

function makeCourier(overrides: Partial<Courier> = {}): Courier {
  return {
    id: 'c1',
    name: 'Sami',
    email: null,
    phone: '+971500000000',
    vehicleType: 'Van',
    plateNumber: null,
    zone: 'Marina',
    region: null,
    country: null,
    status: 'ACTIVE',
    createdAt: '2026-07-01T00:00:00.000Z',
    hasAccessCode: false,
    activeAssignments: 2,
    ...overrides,
  };
}

function resolveWith(couriers: Courier[]) {
  fetchCouriers.mockResolvedValue({
    couriers,
    total: couriers.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
}

beforeEach(() => {
  // Filters persist in the URL now, so without this a status applied in one
  // test would leak into the next one's initial fetch.
  urlState.reset();
  fetchCouriers.mockReset();
  issueAccessCode.mockReset();
  revokeAccessCode.mockReset();
});

describe('the list', () => {
  it('shows a courier with their zone and active jobs', async () => {
    resolveWith([makeCourier()]);

    render(<CouriersTable />);

    expect(await screen.findByText('Sami')).toBeInTheDocument();
    expect(screen.getByText('Marina')).toBeInTheDocument();
  });

  it('says whether a code exists, rather than leaving it blank', async () => {
    // A courier with no code cannot sign in. That is a fact about them, not
    // missing data, so it is stated.
    resolveWith([makeCourier({ hasAccessCode: false })]);

    render(<CouriersTable />);

    expect(await screen.findByText(/not issued/i)).toBeInTheDocument();
  });

  it('never renders anything resembling the code itself', async () => {
    resolveWith([makeCourier({ hasAccessCode: true })]);

    const { container } = render(<CouriersTable />);
    await screen.findByText('Sami');

    // The API sends only `hasAccessCode`; nothing here should surface a hash.
    expect(container.textContent).not.toMatch(/accessCode|[0-9a-f]{32}/i);
  });
});

describe('issuing an access code', () => {
  async function issue() {
    resolveWith([makeCourier()]);
    issueAccessCode.mockResolvedValue({
      courier: { id: 'c1', name: 'Sami' },
      code: 'ABCD-EFGH-JKMN',
    });

    render(<CouriersTable />);
    await screen.findByText('Sami');
    await userEvent.click(screen.getByRole('button', { name: /issue an access code/i }));
  }

  it('shows the code once, and says so', async () => {
    await issue();

    expect(await screen.findByText('ABCD-EFGH-JKMN')).toBeInTheDocument();
    // The warning is the point: dismissing without saving means reissuing.
    expect(screen.getByText(/only time it can be shown/i)).toBeInTheDocument();
  });

  it('presents it as an alertdialog, not a passing notice', async () => {
    await issue();

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('hides it only on a deliberate dismissal', async () => {
    await issue();
    await screen.findByText('ABCD-EFGH-JKMN');

    await userEvent.click(screen.getByRole('button', { name: /i've saved it/i }));

    await waitFor(() => {
      expect(screen.queryByText('ABCD-EFGH-JKMN')).not.toBeInTheDocument();
    });
  });

  it('reloads the list so the code column stops saying "not issued"', async () => {
    await issue();
    await screen.findByText('ABCD-EFGH-JKMN');

    // Once on mount, once after issuing.
    await waitFor(() => {
      expect(fetchCouriers.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('offers reissue rather than issue when one already exists', async () => {
    resolveWith([makeCourier({ hasAccessCode: true })]);

    render(<CouriersTable />);
    await screen.findByText('Sami');

    expect(screen.getByRole('button', { name: /reissue the access code/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^issue an access code/i })).not.toBeInTheDocument();
  });

  it('surfaces the server refusal for a deactivated courier', async () => {
    // Issuing working credentials to someone who has left is how access
    // outlives employment — the API refuses, and the reason is kept.
    resolveWith([makeCourier({ status: 'INACTIVE' })]);
    issueAccessCode.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Reactivate this courier before issuing a code'),
    );

    render(
      <>
        <CouriersTable />
        <Toaster />
      </>,
    );
    await screen.findByText('Sami');
    await userEvent.click(screen.getByRole('button', { name: /issue an access code/i }));

    expect(await screen.findByText(/reactivate this courier/i)).toBeInTheDocument();
  });
});

describe('revoking', () => {
  it('confirms before revoking, and explains what survives', async () => {
    resolveWith([makeCourier({ hasAccessCode: true })]);

    render(<CouriersTable />);
    await screen.findByText('Sami');
    await userEvent.click(screen.getByRole('button', { name: /revoke sami/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // Their history is kept — worth saying, so nobody avoids revoking.
    expect(screen.getByText(/history is kept/i)).toBeInTheDocument();
    expect(revokeAccessCode).not.toHaveBeenCalled();
  });

  it('revokes on confirmation', async () => {
    resolveWith([makeCourier({ hasAccessCode: true })]);
    revokeAccessCode.mockResolvedValue(undefined);

    render(
      <>
        <CouriersTable />
        <Toaster />
      </>,
    );
    await screen.findByText('Sami');
    await userEvent.click(screen.getByRole('button', { name: /revoke sami/i }));
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));

    await waitFor(() => expect(revokeAccessCode).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/no longer sign in/i)).toBeInTheDocument();
  });

  it('offers no revoke control when there is no code', async () => {
    resolveWith([makeCourier({ hasAccessCode: false })]);

    render(<CouriersTable />);
    await screen.findByText('Sami');

    expect(screen.queryByRole('button', { name: /revoke sami/i })).not.toBeInTheDocument();
  });
});

/**
 * B4.4 — `status` was typed in `CourierListParams` and accepted by the
 * backend, but the table never sent it and had no control to set it.
 */
describe('status filter', () => {
  it('does not send a status filter by default', async () => {
    resolveWith([makeCourier()]);
    render(<CouriersTable />);

    await screen.findByText('Sami');

    await waitFor(() => expect(fetchCouriers).toHaveBeenCalled());
    const call = fetchCouriers.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('status');
  });

  it('sends the chosen status once picked', async () => {
    resolveWith([makeCourier()]);
    render(<CouriersTable />);

    await screen.findByText('Sami');
    await userEvent.click(screen.getByRole('combobox', { name: /status/i }));
    await userEvent.click(await screen.findByRole('option', { name: /^inactive$/i }));

    await waitFor(() =>
      expect(fetchCouriers).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'INACTIVE' }),
      ),
    );
  });
});

describe('failure states', () => {
  it('renders an error rather than an empty roster', async () => {
    fetchCouriers.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CouriersTable />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });

  it('distinguishes a permission problem', async () => {
    fetchCouriers.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'nope'));

    render(<CouriersTable />);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders Arabic headers', async () => {
    resolveWith([makeCourier()]);

    render(<CouriersTable />, { locale: 'ar' });

    expect(await screen.findByText('المندوب')).toBeInTheDocument();
  });
});
