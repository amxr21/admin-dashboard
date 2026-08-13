import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { DataExportPanel } from '../data-export-panel';
import type { AuditEntry } from '@/lib/audit-api';
import type { ResourceSchema } from '@/lib/resource-api';

/**
 * B3.3 — Data export centre + history.
 *
 * What's worth pinning: no new history model exists — "recent exports" reads
 * the SAME audit trail every other write already logs to, filtered to
 * `*.export` actions client-side (the backend's `action` filter is an exact
 * match, so a suffix filter has nowhere server-side to live) — and the
 * resource picker lists exactly what `/r/_schema` returns, never a hardcoded
 * set, since that endpoint is already permission-filtered per caller.
 */

const fetchSchema = vi.hoisted(() => vi.fn());
const exportResourceCsv = vi.hoisted(() => vi.fn());
const fetchAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, fetchSchema, exportResourceCsv };
});

vi.mock('@/lib/audit-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit-api')>();
  return { ...actual, fetchAudit };
});

function makeResource(overrides: Partial<ResourceSchema> = {}): ResourceSchema {
  return {
    resource: 'products',
    label: 'Products',
    group: 'catalogue',
    labelField: 'name',
    permissionArea: 'products',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    permissions: {},
    fields: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    action: 'products.export',
    entity: 'products',
    entityId: null,
    actorId: 'u1',
    actorEmail: 'owner@example.test',
    actorRole: 'OWNER',
    changes: { rowCount: { from: null, to: 3 }, truncated: { from: null, to: false } },
    outcome: 'SUCCESS',
    requestId: null,
    ip: null,
    userAgent: null,
    createdAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSchema.mockResolvedValue([makeResource()]);
  exportResourceCsv.mockResolvedValue(undefined);
  fetchAudit.mockResolvedValue({
    entries: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    nextCursor: null,
  });
});

describe('DataExportPanel — export centre', () => {
  it('lists resources from the schema endpoint, not a hardcoded set', async () => {
    fetchSchema.mockResolvedValue([makeResource({ resource: 'products', label: 'Products' })]);
    render(<DataExportPanel />);

    await waitFor(() => expect(fetchSchema).toHaveBeenCalled());
    expect(await screen.findByText('Products')).toBeInTheDocument();
  });

  it('exports the selected resource on click', async () => {
    render(<DataExportPanel />);

    await screen.findByText('Products');
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(exportResourceCsv).toHaveBeenCalledWith('products'));
  });

  it('refreshes history after a successful export', async () => {
    render(<DataExportPanel />);

    await screen.findByText('Products');
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(fetchAudit).toHaveBeenCalledTimes(2));
  });
});

describe('DataExportPanel — export history', () => {
  it('shows only entries whose action ends in .export', async () => {
    fetchAudit.mockResolvedValue({
      entries: [
        makeEntry({ id: 'a1', action: 'products.export', entity: 'products' }),
        makeEntry({ id: 'a2', action: 'products.update', entity: 'products' }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      nextCursor: null,
    });

    render(<DataExportPanel />);

    const rows = await screen.findAllByText('products');
    expect(rows).toHaveLength(1);
  });

  it('shows an empty state when nothing has been exported yet', async () => {
    render(<DataExportPanel />);
    expect(await screen.findByText(/no exports yet/i)).toBeInTheDocument();
  });

  it('surfaces a failed history load with a retry', async () => {
    fetchAudit.mockRejectedValue(new Error('boom'));

    render(<DataExportPanel />);

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
