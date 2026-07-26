import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ResourceTable } from '../resource-table';
import type { ResourceSchema } from '@/lib/resource-api';

/**
 * One table for every resource. What matters is that it renders from the
 * SCHEMA rather than from hardcoded columns, and that every query goes to the
 * server — the engine validates sort and filter keys against the config, so
 * doing either client-side would bypass that check.
 */

const fetchRows = vi.hoisted(() => vi.fn());

vi.mock('@/lib/resource-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resource-api')>();
  return { ...actual, fetchRows };
});

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
