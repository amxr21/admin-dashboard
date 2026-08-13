import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect, useReducer, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/sonner';
import { ResourceTable } from '../resource-table';
import type { ResourceSchema } from '@/lib/resource-api';

// The "view history" link renders a real next-intl Link, which next-intl
// resolves through `next/navigation` — unavailable in this test environment.
// Same stub as returns-table.test.tsx.
/**
 * A STATEFUL stand-in for the URL bar.
 *
 * Search, filters and page now round-trip through the query string, so a mock
 * that accepts a `replace()` and then keeps reporting an empty
 * `useSearchParams()` would break the loop the component depends on: it writes
 * the filter, reads back "no filter", and never re-fetches. Every assertion
 * below about applying a filter is really an assertion about that round trip,
 * so the mock has to hold the value the way a browser would.
 *
 * `notify` re-renders subscribers on write, standing in for the navigation
 * that would otherwise re-render the tree.
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
      // Braced: `Set.delete` returns a boolean, and an effect cleanup must
      // return void or another function.
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
  usePathname: () => '/admin/r/customers',
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    // Subscribing re-renders this component when the mock URL changes,
    // which is what the real hook does on navigation.
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => urlState.subscribe(force), []);
    return urlState.get();
  },
}));

/**
 * One table for every resource. What matters is that it renders from the
 * SCHEMA rather than from hardcoded columns, and that every query goes to the
 * server — the engine validates sort and filter keys against the config, so
 * doing either client-side would bypass that check.
 */

const fetchRows = vi.hoisted(() => vi.fn());
const deleteRow = vi.hoisted(() => vi.fn());
const fetchRelationOptions = vi.hoisted(() =>
  vi.fn(() => Promise.resolve([] as { value: string; label: string }[])),
);

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
    { name: 'isSubscribed', label: 'Subscribed', type: 'boolean' },
    {
      name: 'categoryId',
      label: 'Category',
      type: 'relation',
      relation: { resource: 'categories', labelField: 'name' },
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

const row = {
  id: 'c1',
  name: 'Ali',
  email: 'ali@example.com',
  city: 'Dubai',
  status: 'ACTIVE',
  isSubscribed: true,
  categoryId: 'cat1',
};

beforeEach(() => {
  fetchRows.mockReset();
  deleteRow.mockReset();
  fetchRelationOptions.mockReset();
  fetchRelationOptions.mockResolvedValue([{ value: 'cat1', label: 'Widgets' }]);
  // Filters persist in the URL now, so without this a filter applied in one
  // test would leak into the next one's initial fetch.
  urlState.reset();
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

  it('sends a boolean filter as a true/false string, exact-match', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByLabelText('Subscribed'));
    await userEvent.click(await screen.findByRole('option', { name: 'Yes' }));

    await waitFor(() => {
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ filters: { isSubscribed: 'true' } }),
      );
    });
  });

  it('degrades a hand-edited non-true/false boolean value to no filter', async () => {
    resolveWith([row]);
    urlState.write('?f_isSubscribed=banana');

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ filters: {} }),
    );
  });

  it('sends a relation filter as the target id', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByLabelText('Category'));
    await userEvent.click(await screen.findByRole('option', { name: 'Widgets' }));

    await waitFor(() => {
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ filters: { categoryId: 'cat1' } }),
      );
    });
  });

  it('hides the relation filter when the target resource has no rows', async () => {
    // An empty dropdown would invite filtering by a value that can never
    // match anything, and offers nothing a user could pick anyway.
    resolveWith([row]);
    fetchRelationOptions.mockResolvedValue([]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
  });

  it('degrades a hand-edited unknown filter field to no filter', async () => {
    resolveWith([row]);
    urlState.write('?f_doesNotExist=whatever');

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ filters: {} }),
    );
  });

  it('shows applied boolean and relation filters as human-readable chips, not raw values', async () => {
    // "true" and a bare category id mean nothing on a chip — the point of a
    // chip is to say what's actually applied in words the user picked.
    resolveWith([row]);
    urlState.write('?f_isSubscribed=true&f_categoryId=cat1');

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(await screen.findByText('Subscribed: Yes')).toBeInTheDocument();
    expect(await screen.findByText('Category: Widgets')).toBeInTheDocument();
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

describe('page size overrides the store-wide default', () => {
  it('sends the setting-derived size by default', async () => {
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    // useAppSettings' test double defaults to 20 — see test/render.tsx.
    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ pageSize: 20 }),
    );
  });

  it('overrides the size from the URL rather than the store-wide setting', async () => {
    resolveWith([row]);
    urlState.write('/admin/r/customers?pageSize=50');

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ pageSize: 50 }),
    );
  });

  it('resets to page 1 when the size changes', async () => {
    // 45 total rows over two pages, so the pagination footer's page-size
    // control is actually reachable (it hides when nothing needs paging).
    resolveWith([row], 45);
    urlState.write('/admin/r/customers?page=3');

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('combobox', { name: /rows per page/i }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));

    await waitFor(() =>
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ pageSize: 50, page: 1 }),
      ),
    );
  });

  it('ignores a nonsense URL value rather than sending it to the server', async () => {
    // A hand-edited `?pageSize=banana` must fall back to the store-wide
    // default, not reach the API as an unactionable request.
    resolveWith([row]);
    urlState.write('/admin/r/customers?pageSize=banana');

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ pageSize: 20 }),
    );
  });
});

describe('per-table density', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to the global setting rather than a hardcoded value', async () => {
    document.documentElement.dataset.density = 'compact';
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    delete document.documentElement.dataset.density;
  });

  it('switching tables keeps each one scoped to its own stored choice', async () => {
    // customers has an explicit compact override; products has none, so it
    // must show whatever the global setting says (comfortable, no attribute
    // set) rather than inheriting customers' choice.
    window.localStorage.setItem('admin-dashboard:table-density:resource:customers', 'compact');
    resolveWith([row]);

    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('persists a choice made through the toggle', async () => {
    resolveWith([row]);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('button', { name: 'Compact' }));

    expect(
      window.localStorage.getItem('admin-dashboard:table-density:resource:customers'),
    ).toBe('compact');
  });
});

describe('column manager', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hides a column from the table when toggled off', async () => {
    resolveWith([row]);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.getByRole('columnheader', { name: 'City' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'City' }));

    expect(screen.queryByRole('columnheader', { name: 'City' })).not.toBeInTheDocument();
    // The row's own data disappears with it — not just the header.
    expect(screen.queryByText('Dubai')).not.toBeInTheDocument();
  });

  it('persists the hidden column across a remount of the same table', async () => {
    resolveWith([row]);
    const first = render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'City' }));
    first.unmount();

    resolveWith([row]);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    expect(screen.queryByRole('columnheader', { name: 'City' })).not.toBeInTheDocument();
  });

  it('restores every column via reset', async () => {
    window.localStorage.setItem(
      'admin-dashboard:hidden-columns:resource:customers',
      JSON.stringify(['city']),
    );
    resolveWith([row]);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');
    expect(screen.queryByRole('columnheader', { name: 'City' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show all columns' }));

    expect(screen.getByRole('columnheader', { name: 'City' })).toBeInTheDocument();
  });
});

describe('select all matching the filter', () => {
  function makeRow(id: string) {
    return { ...row, id };
  }

  it('walks every page and returns every id when the page is fully selected', async () => {
    // 3 total, page size 20 — one page covers everything, so the walk stops
    // after its first request.
    resolveWith([row], 3);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));

    fetchRows.mockResolvedValueOnce({
      rows: [makeRow('c1'), makeRow('c2'), makeRow('c3')],
      total: 3,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    await userEvent.click(screen.getByRole('button', { name: /select all 3 matching rows/i }));

    await waitFor(() =>
      expect(screen.getAllByText('3 selected')[0]).toBeInTheDocument(),
    );
    // Walked with the SERVER's max page size, not the view's own page size —
    // fewest possible requests to reach the full matching set.
    expect(fetchRows).toHaveBeenLastCalledWith(
      'customers',
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it('makes one request per page until every matching row is collected', async () => {
    resolveWith([row], 3);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));

    fetchRows.mockReset();
    fetchRows
      .mockResolvedValueOnce({
        rows: [makeRow('c1')],
        total: 3,
        page: 1,
        pageSize: 1,
        totalPages: 3,
      })
      .mockResolvedValueOnce({
        rows: [makeRow('c2')],
        total: 3,
        page: 2,
        pageSize: 1,
        totalPages: 3,
      })
      .mockResolvedValueOnce({
        rows: [makeRow('c3')],
        total: 3,
        page: 3,
        pageSize: 1,
        totalPages: 3,
      });

    await userEvent.click(screen.getByRole('button', { name: /select all 3 matching rows/i }));

    await waitFor(() => expect(screen.getAllByText('3 selected')[0]).toBeInTheDocument());
    expect(fetchRows).toHaveBeenCalledTimes(3);
  });

  it('refuses rather than silently truncating past the cap', async () => {
    // Far beyond MAX_SELECT_ALL (2000) — the walk must stop and refuse
    // instead of handing back a selection that LOOKS complete but isn't.
    resolveWith([row], 5000);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));

    fetchRows.mockReset();
    fetchRows.mockImplementation(async (_resource: string, params: { page: number }) => ({
      rows: [makeRow(`c${String(params.page)}`)],
      total: 5000,
      page: params.page,
      pageSize: 100,
      totalPages: 50,
    }));

    await userEvent.click(
      screen.getByRole('button', { name: /select all 5000 matching rows/i }),
    );

    expect(await screen.findByText(/too many rows/i)).toBeInTheDocument();
    // The failed attempt must not silently leave a partial, capped selection
    // behind — the count still reads as the page-only selection from before.
    expect(screen.queryByText('2000 selected')).not.toBeInTheDocument();
  });

  it('sends the current search and filters on every page of the walk, not just the first', async () => {
    resolveWith([row], 3);
    render(<ResourceTable schema={schema} />);
    await screen.findByText('Ali');

    await userEvent.type(screen.getByLabelText('Search'), 'ali');
    await waitFor(() =>
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ search: 'ali' }),
      ),
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }));

    fetchRows.mockResolvedValueOnce({
      rows: [makeRow('c1'), makeRow('c2'), makeRow('c3')],
      total: 3,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });

    await userEvent.click(screen.getByRole('button', { name: /select all 3 matching rows/i }));

    await waitFor(() =>
      expect(fetchRows).toHaveBeenLastCalledWith(
        'customers',
        expect.objectContaining({ search: 'ali' }),
      ),
    );
  });
});
