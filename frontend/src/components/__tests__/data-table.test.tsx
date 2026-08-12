import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { mockMatchMedia } from '@/test/match-media';
import { DataTable, type Column } from '../data-table';

/**
 * The DataTable carries the state matrix every list page depends on, plus
 * selection and sorting. A gap here shows up on every page at once.
 */

interface Row {
  id: string;
  name: string;
  total: number;
}

const ROWS: Row[] = [
  { id: '1', name: 'Charlie', total: 30 },
  { id: '2', name: 'alice', total: 10 },
  { id: '3', name: 'Bob', total: 20 },
];

const COLUMNS: Column<Row>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name },
  {
    id: 'total',
    header: 'Total',
    cell: (row) => row.total,
    sortValue: (row) => row.total,
    align: 'end',
  },
];

function setup(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} {...props} />,
  );
}

/** Body rows only — excludes the header row. */
function bodyRows() {
  const [, ...rows] = screen.getAllByRole('row');
  return rows;
}

describe('state matrix', () => {
  it('renders rows when data is present', () => {
    setup();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(3);
  });

  it('shows skeletons while loading, not an empty table', () => {
    // An empty table during load reads as "no data", which is a different and
    // much more alarming message.
    setup({ isLoading: true, skeletonRows: 4 });

    expect(screen.queryByText('Charlie')).not.toBeInTheDocument();
    expect(bodyRows()).toHaveLength(4);
  });

  it('marks the body busy while loading', () => {
    // Screen readers need the loading STATE announced; the skeleton boxes
    // themselves are aria-hidden and would otherwise be silent.
    setup({ isLoading: true });

    // getAllByRole: thead and tbody are both rowgroups.
    const bodies = screen.getAllByRole('rowgroup');
    expect(bodies.some((el) => el.getAttribute('aria-busy') === 'true')).toBe(true);
  });

  it('distinguishes error from empty', () => {
    // These are NOT the same thing. "No results match your filters" invites
    // the user to change filters; "we couldn't load this" invites a retry.
    setup({ data: [], error: 'Could not load orders' });

    expect(screen.getByText('Could not load orders')).toBeInTheDocument();
  });

  it('offers a retry when a handler is provided', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    setup({ data: [], error: 'Network error', onRetry });

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows an empty message when there is genuinely no data', () => {
    setup({ data: [] });
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('prefers a custom empty message', () => {
    setup({ data: [], emptyMessage: 'No orders yet' });
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });
});

describe('selection', () => {
  it('renders no checkbox column when selection is not wired up', () => {
    setup();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('selects and deselects a single row', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    setup({ selectedIds: new Set<string>(), onSelectionChange });

    // [0] is the header select-all.
    await user.click(screen.getAllByRole('checkbox')[1]!);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });

  it('selects every row from the header checkbox', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    setup({ selectedIds: new Set<string>(), onSelectionChange });

    await user.click(screen.getAllByRole('checkbox')[0]!);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1', '2', '3']));
  });

  it('clears the selection when all rows are already selected', async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    setup({ selectedIds: new Set(['1', '2', '3']), onSelectionChange });

    await user.click(screen.getAllByRole('checkbox')[0]!);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });

  it('marks the header checkbox indeterminate on a partial selection', () => {
    // A plain unchecked box here would imply "nothing selected", which is a lie
    // and leads to accidental select-all-then-delete.
    setup({ selectedIds: new Set(['1']), onSelectionChange: vi.fn() });

    expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute(
      'data-state',
      'indeterminate',
    );
  });

  it('marks the selected row for styling', () => {
    setup({ selectedIds: new Set(['1']), onSelectionChange: vi.fn() });

    expect(bodyRows()[0]).toHaveAttribute('data-state', 'selected');
    expect(bodyRows()[1]).not.toHaveAttribute('data-state');
  });

  it('shows bulk actions only once something is selected', () => {
    const { rerender } = render(
      <DataTable
        data={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        selectedIds={new Set<string>()}
        onSelectionChange={vi.fn()}
        bulkActions={() => <button type="button">Delete</button>}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    rerender(
      <DataTable
        data={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        selectedIds={new Set(['1'])}
        onSelectionChange={vi.fn()}
        bulkActions={() => <button type="button">Delete</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('reports the selected count', () => {
    setup({
      selectedIds: new Set(['1', '2']),
      onSelectionChange: vi.fn(),
      bulkActions: () => null,
    });

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});

/**
 * "Select all N matching filter" — offered ALONGSIDE the page-only header
 * checkbox, never replacing it. `DataTable` only ever sees one page of
 * `data`, so it cannot fetch the rest itself; `selectAllMatching.fetchAllIds`
 * is the caller's job (it owns the resource, filters and API client). This
 * component's responsibility is just: announce there's more, call the
 * callback, and surface whatever it resolves or throws.
 */
describe('select all matching the filter', () => {
  it('does not appear when nothing is selected', () => {
    setup({
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 50, fetchAllIds: vi.fn() },
    });

    expect(screen.queryByText(/matching/i)).not.toBeInTheDocument();
  });

  it('does not appear on a partial page selection', () => {
    setup({
      selectedIds: new Set(['1']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 50, fetchAllIds: vi.fn() },
    });

    expect(screen.queryByText(/matching/i)).not.toBeInTheDocument();
  });

  it('does not appear when the whole page is selected but that IS everything', () => {
    // totalMatching equals the page — there is nothing further to escalate to.
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 3, fetchAllIds: vi.fn() },
    });

    expect(screen.queryByText(/matching/i)).not.toBeInTheDocument();
  });

  it('appears once the full page is selected and more rows exist beyond it', () => {
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 50, fetchAllIds: vi.fn() },
    });

    expect(
      screen.getByRole('button', { name: 'Select all 50 matching rows' }),
    ).toBeInTheDocument();
  });

  it('replaces the selection with every fetched id, not just adds to it', async () => {
    const onSelectionChange = vi.fn();
    const fetchAllIds = vi.fn().mockResolvedValue(['1', '2', '3', '4', '5']);
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange,
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 5, fetchAllIds },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Select all 5 matching rows' }));

    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1', '2', '3', '4', '5'])),
    );
  });

  it('shows a loading state while the fetch is in flight', async () => {
    let resolveFetch!: (ids: string[]) => void;
    const fetchAllIds = vi.fn(
      () => new Promise<string[]>((resolve) => { resolveFetch = resolve; }),
    );
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 5, fetchAllIds },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Select all 5 matching rows' }));

    expect(await screen.findByRole('button', { name: 'Selecting…' })).toBeDisabled();
    resolveFetch(['1', '2', '3', '4', '5']);
  });

  it('surfaces the real thrown message, not a generic fallback', async () => {
    const fetchAllIds = vi.fn().mockRejectedValue(new Error('Too many rows, narrow the filter'));
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 5000, fetchAllIds },
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Select all 5000 matching rows' }),
    );

    expect(await screen.findByText('Too many rows, narrow the filter')).toBeInTheDocument();
  });

  it('falls back to a generic message for a non-Error throw', async () => {
    const fetchAllIds = vi.fn().mockRejectedValue('not an Error instance');
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
      selectAllMatching: { totalMatching: 5, fetchAllIds },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Select all 5 matching rows' }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('is entirely absent when the caller does not opt in', () => {
    setup({
      selectedIds: new Set(['1', '2', '3']),
      onSelectionChange: vi.fn(),
      bulkActions: () => <button type="button">Delete</button>,
    });

    expect(screen.queryByText(/matching/i)).not.toBeInTheDocument();
  });
});

describe('sorting', () => {
  function nameColumnValues() {
    return bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent);
  }

  /** Both columns are sortable, so queries must be scoped. [0] is `name`. */
  function nameSortButton() {
    return screen.getAllByRole('button', { name: /^sort/i })[0]!;
  }

  it('sorts ascending on first click', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(nameSortButton());

    // Case-insensitive: 'alice' before 'Bob' before 'Charlie'. A codepoint sort
    // would put every capital letter before every lowercase one.
    expect(nameColumnValues()).toEqual(['alice', 'Bob', 'Charlie']);
  });

  it('reverses on second click', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(nameSortButton());
    await user.click(nameSortButton());

    expect(nameColumnValues()).toEqual(['Charlie', 'Bob', 'alice']);
  });

  it('returns to the original order on third click', async () => {
    // Without this third state there is no way back to the server's ordering.
    const user = userEvent.setup();
    setup();

    await user.click(nameSortButton());
    await user.click(nameSortButton());
    await user.click(nameSortButton());

    expect(nameColumnValues()).toEqual(['Charlie', 'alice', 'Bob']);
  });

  it('sorts numbers numerically, not lexically', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        data={[
          { id: '1', name: 'a', total: 100 },
          { id: '2', name: 'b', total: 9 },
        ]}
        columns={COLUMNS}
        getRowId={(row) => row.id}
      />,
    );

    // Lexically "100" < "9". Numerically 9 < 100.
    await user.click(screen.getAllByRole('button', { name: /sort ascending/i })[1]!);

    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[1]?.textContent)).toEqual(
      ['9', '100'],
    );
  });

  it('exposes sort state to assistive tech', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(nameSortButton());

    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('does not make a column sortable without a sortValue', () => {
    render(
      <DataTable
        data={ROWS}
        columns={[{ id: 'name', header: 'Name', cell: (row) => row.name }]}
        getRowId={(row) => row.id}
      />,
    );

    expect(screen.queryByRole('button', { name: /sort/i })).not.toBeInTheDocument();
  });

  it('sorts null values last in BOTH directions', async () => {
    // Flipping nulls with the sort makes "sort by delivery date" surface
    // undelivered orders at the top, which is never the intent.
    const user = userEvent.setup();
    const withNulls: { id: string; label: string | null }[] = [
      { id: '1', label: 'b' },
      { id: '2', label: null },
      { id: '3', label: 'a' },
    ];

    render(
      <DataTable
        data={withNulls}
        columns={[
          {
            id: 'label',
            header: 'Label',
            cell: (row) => row.label ?? '—',
            sortValue: (row) => row.label,
          },
        ]}
        getRowId={(row) => row.id}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: /^sort/i })[0]!);
    expect(nameColumnValues()).toEqual(['a', 'b', '—']);

    await user.click(screen.getAllByRole('button', { name: /^sort/i })[0]!);
    expect(nameColumnValues()).toEqual(['b', 'a', '—']);
  });
});

describe('Arabic locale', () => {
  it('sorts Arabic strings alphabetically, not by codepoint', async () => {
    // `a < b` on Arabic gives Unicode order, which is NOT alphabetical.
    // Intl.Collator is the only correct way to sort these.
    const user = userEvent.setup();
    const arabicRows = [
      { id: '1', label: 'تامر' },
      { id: '2', label: 'أحمد' },
      { id: '3', label: 'بدر' },
    ];

    render(
      <DataTable
        data={arabicRows}
        columns={[
          {
            id: 'label',
            header: 'الاسم',
            cell: (row) => row.label,
            sortValue: (row) => row.label,
          },
        ]}
        getRowId={(row) => row.id}
      />,
      { locale: 'ar' },
    );

    await user.click(screen.getAllByRole('button', { name: /^ترتيب/ })[0]!);

    expect(
      bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent),
    ).toEqual(['أحمد', 'بدر', 'تامر']);
  });

  it('renders Arabic UI strings', () => {
    render(
      <DataTable
        data={[]}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        selectedIds={new Set<string>()}
        onSelectionChange={vi.fn()}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByLabelText('تحديد جميع الصفوف')).toBeInTheDocument();
  });
});

/**
 * Below the table→card breakpoint, `DataTable` swaps to a stacked-card list
 * — same data, same six states, different layout. `useIsMobileViewport`
 * decides which one mounts; mocking the media query is how these tests
 * cross that decision, same technique `useReducedMotion` tests already use.
 *
 * The property that matters most: exactly ONE variant renders at a time.
 * The first version of this feature rendered both and hid one with CSS,
 * which passed visually in a browser but made every text query in this file
 * (and every OTHER file testing a table) ambiguous under jsdom, since jsdom
 * never evaluates a media query and therefore never actually hides anything.
 */
describe('responsive: card fallback below the breakpoint', () => {
  afterEach(() => {
    // Each test wires its own mock; leaving a stale matchMedia stub active
    // would silently affect whichever suite runs next in the same worker.
    mockMatchMedia(false).restore();
  });

  it('renders the real table by default, unmocked', () => {
    setup();

    expect(screen.getByRole('table')).toBeInTheDocument();
    // The card list uses <dl>, never a table role.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders cards instead of a table once the viewport reports mobile', async () => {
    mockMatchMedia(true);
    setup();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(await screen.findByText('Charlie')).toBeInTheDocument();
  });

  it('never renders both variants at once', async () => {
    mockMatchMedia(true);
    setup();

    // The regression this guards: "Charlie" existing in exactly one place.
    // Multiple matches here is exactly the failure mode the CSS-only
    // approach produced under jsdom.
    expect(await screen.findAllByText('Charlie')).toHaveLength(1);
  });

  it('shows the loading skeleton in card form, not a table skeleton', () => {
    mockMatchMedia(true);
    const { container } = setup({ isLoading: true });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('shows the error state with retry in card form', async () => {
    mockMatchMedia(true);
    const onRetry = vi.fn();
    setup({ error: 'Could not load', onRetry });

    expect(await screen.findByText('Could not load')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the empty state in card form', async () => {
    mockMatchMedia(true);
    setup({ data: [] });

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  });

  it('supports row selection in card form', async () => {
    mockMatchMedia(true);
    const onSelectionChange = vi.fn();
    setup({ selectedIds: new Set<string>(), onSelectionChange });

    await screen.findByText('Charlie');
    const checkboxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await userEvent.click(checkboxes[0]!);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });

  it('separates the actions column into its own trailing area, not a labelled field', async () => {
    mockMatchMedia(true);
    const columnsWithActions: Column<Row>[] = [
      ...COLUMNS,
      {
        id: '__actions',
        header: <span className="sr-only">Actions</span>,
        cell: (row) => <button type="button">Edit {row.name}</button>,
      },
    ];
    render(<DataTable data={ROWS} columns={columnsWithActions} getRowId={(row) => row.id} />);

    expect(await screen.findByRole('button', { name: 'Edit Charlie' })).toBeInTheDocument();
    // Not rendered as a "Actions: <button>" field pair — the sr-only header
    // text must not leak into the card as visible label prose.
    expect(screen.queryByText('Actions', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('responds live if the viewport crosses the breakpoint after mount', async () => {
    const controller = mockMatchMedia(false);
    setup();
    expect(screen.getByRole('table')).toBeInTheDocument();

    controller.emit(true);

    // `emit` fires the listener synchronously, but React's re-render from
    // that `setState` still needs a tick — `findByText` alone raced it.
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });
});
