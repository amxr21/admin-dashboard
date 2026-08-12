import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { AuditTable } from '../audit-table';
import type { AuditEntry } from '@/lib/audit-api';

/**
 * The audit viewer.
 *
 * What is worth pinning here is not "does a table render" — it is the handful
 * of claims this page makes that would be actively harmful if they were wrong:
 *
 *  - a DENIED row must not read as a change that happened
 *  - an export must cover the FILTER, not the visible page
 *  - the read-only guarantee must be stated, since it is the whole reason
 *    these rows count as evidence
 *  - a hand-edited `?outcome=NONSENSE` must not travel to the API
 */

const fetchAudit = vi.hoisted(() => vi.fn());
const fetchAuditEntities = vi.hoisted(() => vi.fn());
const fetchAuditActions = vi.hoisted(() => vi.fn());
const exportAuditCsv = vi.hoisted(() => vi.fn());
const fetchStaff = vi.hoisted(() => vi.fn());

vi.mock('@/lib/audit-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit-api')>();
  return { ...actual, fetchAudit, fetchAuditEntities, fetchAuditActions, exportAuditCsv };
});

vi.mock('@/lib/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/staff-api')>();
  return { ...actual, fetchStaff };
});

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

/**
 * Overrides the setup-file default so these tests can seed real query params —
 * the deep-link and hand-edited-URL cases below are the whole point. The setup
 * file documents local overrides as the supported way to do this.
 */
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/admin/audit',
}));

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    action: 'product.updated',
    entity: 'products',
    entityId: 'p1',
    actorId: 'u1',
    actorEmail: 'owner@example.test',
    actorRole: 'OWNER',
    changes: { price: { from: '19.99', to: '24.99' } },
    outcome: 'SUCCESS',
    requestId: 'req-abcdef123456',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    createdAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
  };
}

function result(entries: AuditEntry[]) {
  return {
    entries,
    total: entries.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    nextCursor: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.current = new URLSearchParams();
  fetchAudit.mockResolvedValue(result([entry()]));
  fetchAuditEntities.mockResolvedValue(['products', 'authz']);
  fetchAuditActions.mockResolvedValue(['product.updated', 'authz.area.denied']);
  fetchStaff.mockResolvedValue({ staff: [], total: 0, page: 1, pageSize: 100, totalPages: 1 });
  exportAuditCsv.mockResolvedValue(undefined);
});

describe('AuditTable', () => {
  it('states that the log is append-only — the reason it is evidence', async () => {
    render(<AuditTable />);

    // Nothing else on screen distinguishes this from an editable table, so the
    // guarantee has to be said out loud rather than implied by the absence of
    // edit buttons.
    expect(await screen.findByText(/append-only/i)).toBeInTheDocument();
    expect(screen.getByText(/kept indefinitely/i)).toBeInTheDocument();
  });

  it('renders a change as a real before → after pair', async () => {
    render(<AuditTable />);

    expect(await screen.findByText('19.99')).toBeInTheDocument();
    expect(screen.getByText('24.99')).toBeInTheDocument();
  });

  it('does not render a denial as though something changed', async () => {
    fetchAudit.mockResolvedValue(
      result([
        entry({
          id: 'a2',
          action: 'authz.area.denied',
          outcome: 'DENIED',
          changes: null,
        }),
      ]),
    );

    render(<AuditTable />);

    // The distinction that matters: a refused attempt changed nothing, and an
    // empty cell would read as missing data rather than as "nothing happened".
    expect(await screen.findByText(/nothing was changed/i)).toBeInTheDocument();

    // Scoped to the row — "Denied" also appears as an option in the outcome
    // filter, and matching that instead would pass with no badge rendered.
    const row = screen.getByRole('row', { name: /authz\.area\.denied/i });
    expect(within(row).getByText(/denied/i, { selector: 'span' })).toBeInTheDocument();
  });

  it('renders context values (IP, request id) that answer "from where"', async () => {
    render(<AuditTable />);

    expect(await screen.findByText('203.0.113.7')).toBeInTheDocument();
    // Truncated for width, but the full value is what gets filtered on.
    expect(screen.getByText('req-abcd')).toBeInTheDocument();
  });

  it('exports the active filter, not just the rows on screen', async () => {
    searchParams.current = new URLSearchParams({ outcome: 'DENIED', entity: 'authz' });

    render(<AuditTable />);
    await screen.findByText(/append-only/i);

    await userEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(exportAuditCsv).toHaveBeenCalled());

    // A reviewer asking for "every denial" means all of them — exporting only
    // the visible page would hand them a file that quietly omits the rest.
    expect(exportAuditCsv).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'DENIED', entity: 'authz' }),
    );
    expect(exportAuditCsv.mock.calls[0]?.[0]).not.toHaveProperty('page');
  });

  it('drops a hand-edited outcome rather than sending it to the API', async () => {
    searchParams.current = new URLSearchParams({ outcome: 'NONSENSE' });

    render(<AuditTable />);

    await waitFor(() => expect(fetchAudit).toHaveBeenCalled());

    // An unknown value reaching the API is a 400 the user can do nothing about,
    // so it degrades to "all" instead.
    const params = fetchAudit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('outcome');
  });

  it('sends the seeded deep-link filters on first load', async () => {
    searchParams.current = new URLSearchParams({ entity: 'products', entityId: 'p1' });

    render(<AuditTable />);

    await waitFor(() => expect(fetchAudit).toHaveBeenCalled());
    expect(fetchAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'products', entityId: 'p1' }),
    );
  });

  it('keeps the export button out of reach when there is nothing to export', async () => {
    fetchAudit.mockResolvedValue(result([]));

    render(<AuditTable />);
    await screen.findByText(/append-only/i);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export/i })).toBeDisabled(),
    );
  });

  it('surfaces a failed load without blaming the user', async () => {
    fetchAudit.mockRejectedValue(new Error('boom'));

    render(<AuditTable />);

    // Empty and failed must not look identical — see data-table.tsx.
    await waitFor(() => expect(fetchAudit).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});
