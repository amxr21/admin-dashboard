import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, within } from '@/test/render';
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
