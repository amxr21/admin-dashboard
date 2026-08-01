import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/sonner';
import { ResourceTable } from '../resource-table';
import type { ResourceSchema } from '@/lib/resource-api';

// The "view history" link renders a real next-intl Link, which next-intl
// resolves through `next/navigation` — unavailable in this test environment.
// Same stub as returns-table.test.tsx.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

/**
 * One table for every resource. What matters is that it renders from the
 * SCHEMA rather than from hardcoded columns, and that every query goes to the
 * server — the engine validates sort and filter keys against the config, so
 * doing either client-side would bypass that check.
 */

const fetchRows = vi.hoisted(() => vi.fn());
const deleteRow = vi.hoisted(() => vi.fn());
const fetchRelationOptions = vi.hoisted(() => vi.fn(() => Promise.resolve([])));

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, fetchRows, deleteRow, fetchRelationOptions };
});

// ResourceTable reads the actor's role to decide whether to show the "view
// history" link to the audit trail — a rendering hint only (see
// useAuth.tsx), so a fixed OWNER stand-in is fine for every test here.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'owner@example.test', name: 'Owner', role: 'OWNER' },
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const schema: ResourceSchema = {
  resource: 'customers',
  label: 'Customers',
  group: 'people',
  labelField: 'name',
  permissionArea: 'customers',
  defaultSort: { field: 'createdAt', dir: 'desc' },
  permissions: { create: true, update: true, delete: true },
  fields: [
    { name: 'id', label: 'ID', type: 'id', inForm: false, readOnly: true },
    { name: 'name', label: 'Name', type: 'text', searchable: true, sortable: true },
    { name: 'email', label: 'Email', type: 'email', searchable: true },
    { name: 'city', label: 'City', type: 'text' },
    {
      name: 'status',
      label: 'Status',
      type: 'enum',
      options: ['ACTIVE', 'ARCHIVED'],
    },
  ],
};

function resolveWith(rows: Record<string, unknown>[], total = rows.length) {
  fetchRows.mockResolvedValue({
    rows,
    total,
    page: 1,
    pageSize: 20,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  });
}

const row = { id: 'c1', name: 'Ali', email: 'ali@example.com', city: 'Dubai', status: 'ACTIVE' };

beforeEach(() => {
  fetchRows.mockReset();
  deleteRow.mockReset();
});

describe('rendering from the schema', () => {
  it('builds columns from the field list', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);

    expect(await screen.findByText('Ali')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /city/i })).toBeInTheDocument();
  });

  it('omits the id column', async () => {
    // An internal identifier is not information the user needs, and it costs a
    // column of width on every table.
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.queryByRole('columnheader', { name: /^id$/i })).not.toBeInTheDocument();
  });
});

describe('queries go to the server', () => {
  it('sends the search term rather than filtering locally', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.type(screen.getByLabelText('Search'), 'ali');

    await waitFor(() => {
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ search: 'ali' }),
      );
    });
  });

  it('sends an enum filter as a field filter', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'ARCHIVED' }));

    await waitFor(() => {
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ filters: { status: 'ARCHIVED' } }),
      );
    });
  });

  it('omits a filter set back to All', async () => {
    // The engine rejects an unknown filter value, so "no filter" has to mean
    // "no parameter" rather than the literal string "all".
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ filters: {} }),
    );
  });

  it('hides the search box when nothing is searchable', async () => {
    // Offering a search that cannot match anything teaches users the box is
    // broken.
    resolveWith([row]);

    render(
      <ResourceTable
        schema={{ ...schema, fields: schema.fields.map((f) => ({ ...f, searchable: false })) }}
      />,
    );
    await screen.findByText('Ali');

    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();
  });
});

describe('failure and empty states', () => {
  it('renders an error rather than an empty table', async () => {
    // An empty table after a failed fetch says "you have no customers", which
    // is a different and much worse statement than "loading failed".
    fetchRows.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ResourceTable schema={schema} />);

    expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument();
  });

  it('distinguishes an expired session', async () => {
    fetchRows.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'nope'));

    render(<ResourceTable schema={schema} />);

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });

  it('names the resource in the empty state', async () => {
    resolveWith([]);

    render(<ResourceTable schema={schema} />);

    expect(await screen.findByText(/no customers yet/i)).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders Arabic controls', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />, { locale: 'ar' });

    expect(await screen.findByLabelText('بحث')).toBeInTheDocument();
  });
});

describe('write actions follow the permissions', () => {
  it('offers create, edit and delete when the config allows them', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.getByRole('button', { name: /new customers/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit ali/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete ali/i })).toBeInTheDocument();
  });

  it('hides them all when the config denies them', async () => {
    // assertPermitted() in resource.service.ts is DEFAULT-DENY, so anything
    // short of an explicit `true` would render a button that always 403s.
    resolveWith([row]);

    render(<ResourceTable schema={{ ...schema, permissions: {} }} />);
    await screen.findByText('Ali');

    expect(screen.queryByRole('button', { name: /new customers/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit ali/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete ali/i })).not.toBeInTheDocument();
  });
});

describe('deleting tells the truth about what happened', () => {
  it('confirms before deleting anything', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('button', { name: /delete ali/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('says "deleted" when the row was really deleted', async () => {
    resolveWith([row]);
    deleteRow.mockResolvedValue({ row, action: 'deleted' });

    render(
      <>
        <ResourceTable schema={schema} />
        <Toaster />
      </>,
    );
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('button', { name: /delete ali/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/1 record deleted/i)).toBeInTheDocument();
  });

  it('says "archived" — not deleted — when the server archived instead', async () => {
    /**
     * The whole point of A3. A resource hook archives rather than deletes when
     * other records still reference the row, and reporting that as a delete
     * would be the UI claiming an outcome the server explicitly refused.
     */
    resolveWith([row]);
    deleteRow.mockResolvedValue({ row, action: 'archived' });

    render(
      <>
        <ResourceTable schema={schema} />
        <Toaster />
      </>,
    );
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('button', { name: /delete ali/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const notice = await screen.findByText(/archived instead of deleted/i);
    expect(notice).not.toHaveTextContent(/1 record deleted/i);
  });

  it('reports both outcomes when a bulk delete produced a mix', async () => {
    const second = { ...row, id: 'c2', name: 'Sara' };
    resolveWith([row, second]);
    deleteRow
      .mockResolvedValueOnce({ row, action: 'deleted' })
      .mockResolvedValueOnce({ row: second, action: 'archived' });

    render(
      <>
        <ResourceTable schema={schema} />
        <Toaster />
      </>,
    );
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const notice = await screen.findByText(/1 record deleted/i);
    expect(notice).toHaveTextContent(/archived instead of deleted/i);
  });

  it('still reports the successes when one row fails', async () => {
    // allSettled, not all: one failure must not hide four successes, and the
    // table has to reload either way.
    const second = { ...row, id: 'c2', name: 'Sara' };
    resolveWith([row, second]);
    deleteRow
      .mockResolvedValueOnce({ row, action: 'deleted' })
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope'));

    render(
      <>
        <ResourceTable schema={schema} />
        <Toaster />
      </>,
    );
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const notice = await screen.findByText(/1 record deleted/i);
    expect(notice).toHaveTextContent(/permission/i);
  });
});

describe('selection has something attached to it', () => {
  it('offers a bulk action once rows are selected', async () => {
    // Selection previously tracked ids with no action anywhere — rows could be
    // ticked and nothing was ever offered.
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(
      screen.queryByRole('button', { name: /delete selected/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /select row/i }));

    expect(
      await screen.findByRole('button', { name: /delete selected/i }),
    ).toBeInTheDocument();
  });
});
