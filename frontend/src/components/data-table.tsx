'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useIsMobileViewport } from '@/hooks/useIsMobileViewport';

/**
 * The dashboard's table.
 *
 * Selection is built in from the start rather than added later — retrofitting
 * it means rewriting row rendering, the header, and every consumer.
 *
 * Handles the full state matrix (loading / error / empty / populated). A table
 * that only renders the happy path isn't finished: an empty array and a failed
 * fetch look identical to the user, and "no results" is a very different
 * message from "we couldn't load this".
 */

export interface Column<T> {
  /** Stable key. Also the sort key when `sortable`. */
  id: string;
  header: ReactNode;
  /** Cell renderer. Keep it presentational — no data fetching. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting. Omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  /** Numeric columns should be end-aligned; text stays start-aligned. */
  align?: 'start' | 'end';
  className?: string;
}

export type SortDirection = 'asc' | 'desc';

interface DataTableProps<T> {
  data: readonly T[];
  columns: readonly Column<T>[];
  /** Stable unique id per row. Selection and React keys both depend on it. */
  getRowId: (row: T) => string;

  isLoading?: boolean;
  /** Non-null renders the error state, which is distinct from empty. */
  error?: string | null;
  onRetry?: () => void;

  /** Omit to disable selection entirely — no checkbox column renders. */
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;

  emptyMessage?: ReactNode;
  /** Rendered above the table when at least one row is selected. */
  bulkActions?: (selectedIds: ReadonlySet<string>) => ReactNode;
  skeletonRows?: number;

  /**
   * Lifts sort into the caller (and, in practice, into the URL).
   *
   * Omit both and the table keeps its own sort in local state — correct for a
   * table whose sort nobody would want to share. Pass both and the sort
   * becomes part of the page's shareable state, so "sorted by oldest first"
   * survives a reload and a pasted link.
   *
   * Controlled and uncontrolled are deliberately all-or-nothing: accepting
   * `sort` without `onSortChange` would render a control that silently does
   * nothing when clicked.
   */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;

  /**
   * Overrides the store-wide `ui.density` setting for THIS table only.
   *
   * Omit to inherit the global `[data-density]` value applied to `<html>` —
   * the correct default for every table that hasn't opted into its own
   * choice. Setting this pins a literal `--table-cell-py` on the table's own
   * wrapper, which wins over the inherited custom property regardless of
   * what the global setting says or later changes to.
   */
  density?: 'comfortable' | 'compact';

  /**
   * Powers "Select all N matching filter", offered ALONGSIDE the page-only
   * `toggleAll` checkbox — never replacing it. Selecting every row currently
   * on screen stays the header checkbox's job, exactly as before; this is
   * the escalation a user reaches for only after noticing the page they
   * selected isn't the whole result.
   *
   * `DataTable` has no way to fetch rows outside the current page itself —
   * it only ever receives one page of `data` — so the actual fetch is the
   * CALLER's responsibility (it already owns the resource, filters and API
   * client). This prop is the announcement of "there's more" plus the
   * callback to ask for it; omit it and the escalation never appears, which
   * is correct for any table that doesn't want to support it yet.
   */
  selectAllMatching?: {
    /** Total rows the current filter matches — from the same paginated
     *  response `data` came from, so it can never be a value the caller
     *  half-manufactured. */
    totalMatching: number;
    /** Resolves every matching id, or throws. `DataTable` shows a loading
     *  state on the button while this is in flight and surfaces a caught
     *  error inline rather than losing it silently. */
    fetchAllIds: () => Promise<string[]>;
  };
}

const DENSITY_CELL_PADDING: Record<'comfortable' | 'compact', string> = {
  comfortable: '0.5rem',
  compact: '0.25rem',
};

export interface SortState {
  id: string;
  direction: SortDirection;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  isLoading = false,
  error = null,
  onRetry,
  selectedIds,
  onSelectionChange,
  emptyMessage,
  bulkActions,
  skeletonRows = 5,
  sort: controlledSort,
  onSortChange,
  density,
  selectAllMatching,
}: DataTableProps<T>) {
  const t = useTranslations('table');
  const tStates = useTranslations('states');
  // `selected` is a pluralised COUNT, so it lives in `counts`, not `table`.
  const tCounts = useTranslations('counts');
  const locale = useLocale();
  const isMobile = useIsMobileViewport();

  // Uncontrolled fallback. Only read when the caller passes neither prop.
  const [uncontrolledSort, setUncontrolledSort] = useState<SortState | null>(null);

  const isControlled = controlledSort !== undefined && onSortChange !== undefined;
  const sort = isControlled ? controlledSort : uncontrolledSort;

  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;

  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
  const [selectAllError, setSelectAllError] = useState<string | null>(null);

  /**
   * Locale-aware collator.
   *
   * `a < b` compares UTF-16 code points, which is NOT alphabetical order in
   * Arabic — sorting أحمد/بدر/تامر that way produces nonsense. `Intl.Collator`
   * also handles case and accents correctly in English, so this is the right
   * default in both locales.
   *
   * `numeric` so "Item 2" sorts before "Item 10".
   */
  const collator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
    [locale],
  );

  const sortedData = useMemo(() => {
    if (!sort) return data;

    const column = columns.find((candidate) => candidate.id === sort.id);
    if (!column?.sortValue) return data;

    const { sortValue } = column;
    const factor = sort.direction === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);

      // Nulls sort last in BOTH directions. Flipping them with the sort makes
      // "sort by delivery date" surface undelivered orders at the top, which
      // is never what the user wanted.
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * factor;
      }
      if (left instanceof Date && right instanceof Date) {
        return (left.getTime() - right.getTime()) * factor;
      }
      return collator.compare(String(left), String(right)) * factor;
    });
  }, [data, columns, sort, collator]);

  const allIds = useMemo(() => sortedData.map(getRowId), [sortedData, getRowId]);

  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));
  const someSelected = allIds.some((id) => selectedIds?.has(id));

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return;
    // Selecting all applies to the CURRENT page's rows only. Silently selecting
    // rows the user cannot see, then bulk-deleting them, is a genuine footgun.
    onSelectionChange(allSelected ? new Set() : new Set(allIds));
  }, [allSelected, allIds, onSelectionChange]);

  const toggleRow = useCallback(
    (id: string) => {
      if (!onSelectionChange || !selectedIds) return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  const selectAllMatchingRows = useCallback(async () => {
    if (!selectAllMatching || !onSelectionChange) return;

    setIsSelectingAllMatching(true);
    setSelectAllError(null);
    try {
      const ids = await selectAllMatching.fetchAllIds();
      onSelectionChange(new Set(ids));
    } catch (caught) {
      // `fetchAllIds` throws a REAL, already-translated message for the
      // known failure case (too many matching rows to select) — that message
      // is the whole reason the escalation exists, so it must reach the
      // user, not get flattened into a generic "something went wrong" that
      // would leave them clicking the same button again with no new
      // information. An unexpected non-Error throw still falls back safely.
      setSelectAllError(
        caught instanceof Error && caught.message ? caught.message : tStates('error.title'),
      );
    } finally {
      setIsSelectingAllMatching(false);
    }
  }, [selectAllMatching, onSelectionChange, tStates]);

  function toggleSort(columnId: string) {
    // asc → desc → unsorted. The third state matters: without it there's no
    // way back to the server's default order.
    const next: SortState | null =
      sort?.id !== columnId
        ? { id: columnId, direction: 'asc' }
        : sort.direction === 'asc'
          ? { id: columnId, direction: 'desc' }
          : null;

    if (isControlled) onSortChange(next);
    else setUncontrolledSort(next);
  }

  const columnCount = columns.length + (selectable ? 1 : 0);

  return (
    <div
      className="space-y-3"
      style={
        density
          ? ({ '--table-cell-py': DENSITY_CELL_PADDING[density] } as CSSProperties)
          : undefined
      }
    >
      {selectable && someSelected && bulkActions ? (
        <div className="bg-muted flex flex-col gap-2 rounded-md px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {tCounts('selected', { count: selectedIds.size })}
            </span>
            <div className="ms-auto flex items-center gap-2">
              {bulkActions(selectedIds)}
              {/* Deselecting by unticking each row is the only way out
                  otherwise, and a selection that survives a filter change is
                  easy to forget about — right up until a bulk action applies to
                  rows that scrolled out of view. */}
              <Button variant="ghost" size="sm" onClick={() => onSelectionChange(new Set())}>
                {t('clearSelection')}
              </Button>
            </div>
          </div>

          {/* The escalation offer — ALONGSIDE the page-only checkbox above,
              never replacing it. Only surfaces once the entire visible page
              is already selected AND there is more beyond it; selecting 3 of
              20 rows on a page has no "matching filter" story to escalate
              to. */}
          {selectAllMatching &&
          allSelected &&
          selectedIds.size < selectAllMatching.totalMatching ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {t('selectAllMatching.prompt', { count: selectAllMatching.totalMatching })}
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={isSelectingAllMatching}
                onClick={() => void selectAllMatchingRows()}
              >
                {isSelectingAllMatching
                  ? t('selectAllMatching.loading')
                  : t('selectAllMatching.action', { count: selectAllMatching.totalMatching })}
              </Button>
              {selectAllError ? (
                <span className="text-destructive">{selectAllError}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {isMobile ? (
        <MobileCardList
          columns={columns}
          sortedData={sortedData}
          getRowId={getRowId}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          emptyMessage={emptyMessage}
          skeletonRows={skeletonRows}
          selectable={selectable}
          selectedIds={selectedIds}
          toggleRow={toggleRow}
          selectRowLabel={t('selectRow')}
          errorTitle={tStates('error.title')}
          emptyTitle={tStates('empty.title')}
        />
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            {selectable ? (
              <TableHead>
                <Checkbox
                  // Indeterminate when only some rows are selected — a plain
                  // unchecked box there implies "nothing selected", which is a lie.
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label={t('selectAll')}
                  disabled={isLoading || allIds.length === 0}
                />
              </TableHead>
            ) : null}

            {columns.map((column) => {
              const isSorted = sort?.id === column.id;
              const sortable = Boolean(column.sortValue);

              return (
                <TableHead
                  key={column.id}
                  className={cn(column.align === 'end' && 'text-end', column.className)}
                  aria-sort={
                    isSorted
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.id)}
                      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      aria-label={
                        isSorted && sort.direction === 'asc'
                          ? t('sortDescending')
                          : t('sortAscending')
                      }
                    >
                      {column.header}
                      {/* Vertical arrows — NOT .icon-directional. Up/down has
                          no reading direction and must not mirror in RTL. */}
                      {isSorted ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody aria-busy={isLoading}>
          {isLoading ? (
            Array.from({ length: skeletonRows }, (_, rowIndex) => (
              <TableRow key={`skeleton-${String(rowIndex)}`}>
                {Array.from({ length: columnCount }, (__, cellIndex) => (
                  <TableCell key={`skeleton-cell-${String(cellIndex)}`}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : error ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="p-2">
                <ErrorSection
                  title={tStates('error.title')}
                  description={error}
                  onRetry={onRetry}
                  className="border-none p-4"
                />
              </TableCell>
            </TableRow>
          ) : sortedData.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                // min-h, not h: a plain-text message centers fine at exactly
                // 32, but a richer `EmptyState` (icon + description + action)
                // needs to grow past it rather than being clipped.
                className="text-muted-foreground min-h-32 text-center text-sm"
              >
                {emptyMessage ?? tStates('empty.title')}
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((row) => {
              const id = getRowId(row);
              const isSelected = selectedIds?.has(id) ?? false;

              return (
                <TableRow key={id} data-state={isSelected ? 'selected' : undefined}>
                  {selectable ? (
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRow(id)}
                        aria-label={t('selectRow')}
                      />
                    </TableCell>
                  ) : null}

                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(column.align === 'end' && 'text-end', column.className)}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      )}
    </div>
  );
}

/**
 * The card fallback below the table→card breakpoint. Same six states, same
 * data, same columns — just a different layout for the same information, so
 * a caller never has to declare content twice.
 *
 * Kept as a separate component (rather than a second branch inline in
 * `DataTable`) so its own hook rules and prop list stay readable — the
 * function above was already doing a lot before this existed.
 */
interface MobileCardListProps<T> {
  columns: readonly Column<T>[];
  sortedData: readonly T[];
  getRowId: (row: T) => string;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  emptyMessage?: ReactNode;
  skeletonRows: number;
  selectable: boolean;
  selectedIds?: ReadonlySet<string>;
  toggleRow: (id: string) => void;
  selectRowLabel: string;
  errorTitle: string;
  emptyTitle: string;
}

function MobileCardList<T>({
  columns,
  sortedData,
  getRowId,
  isLoading,
  error,
  onRetry,
  emptyMessage,
  skeletonRows,
  selectable,
  selectedIds,
  toggleRow,
  selectRowLabel,
  errorTitle,
  emptyTitle,
}: MobileCardListProps<T>) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: skeletonRows }, (_, rowIndex) => (
          <div key={`card-skeleton-${String(rowIndex)}`} className="space-y-2 rounded-lg border p-3">
            {Array.from({ length: Math.min(columns.length, 4) }, (__, cellIndex) => (
              <Skeleton key={cellIndex} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorSection title={errorTitle} description={error} onRetry={onRetry} />;
  }

  if (sortedData.length === 0) {
    return (
      <div className="text-muted-foreground min-h-32 rounded-lg border p-6 text-center text-sm">
        {emptyMessage ?? emptyTitle}
      </div>
    );
  }

  // The actions column has no meaningful "label: value" reading — it renders
  // as a trailing action row instead, the same visual anchor it would be at
  // the end of a table row.
  const fieldColumns = columns.filter((column) => column.id !== '__actions');
  const actionsColumn = columns.find((column) => column.id === '__actions');

  return (
    <div className="space-y-2">
      {sortedData.map((row) => {
        const id = getRowId(row);
        const isSelected = selectedIds?.has(id) ?? false;

        return (
          <div
            key={id}
            data-state={isSelected ? 'selected' : undefined}
            className="data-[state=selected]:bg-muted rounded-lg border p-3"
          >
            <div className="flex items-start gap-3">
              {selectable ? (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleRow(id)}
                  aria-label={selectRowLabel}
                  className="mt-0.5"
                />
              ) : null}

              {/* The FIRST field column doubles as the card's own title,
                  matching reading order — a card leads with whatever the
                  table would have shown leftmost/start-most too. */}
              <dl className="min-w-0 flex-1 space-y-1.5">
                {fieldColumns.map((column, index) => (
                  <div
                    key={column.id}
                    className={cn(
                      index === 0
                        ? 'font-medium'
                        : 'flex items-baseline justify-between gap-3 text-sm',
                    )}
                  >
                    {index === 0 ? (
                      <dd>{column.cell(row)}</dd>
                    ) : (
                      <>
                        <dt className="text-muted-foreground shrink-0">{column.header}</dt>
                        <dd className={cn(column.align === 'end' && 'text-end')}>
                          {column.cell(row)}
                        </dd>
                      </>
                    )}
                  </div>
                ))}
              </dl>

              {actionsColumn ? <div className="shrink-0">{actionsColumn.cell(row)}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
