'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

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
}: DataTableProps<T>) {
  const t = useTranslations('table');
  const tStates = useTranslations('states');
  // `selected` is a pluralised COUNT, so it lives in `counts`, not `table`.
  const tCounts = useTranslations('counts');
  const locale = useLocale();

  const [sort, setSort] = useState<{ id: string; direction: SortDirection } | null>(
    null,
  );

  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;

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

  function toggleSort(columnId: string) {
    setSort((current) => {
      if (current?.id !== columnId) return { id: columnId, direction: 'asc' };
      // asc → desc → unsorted. The third state matters: without it there's no
      // way back to the server's default order.
      if (current.direction === 'asc') return { id: columnId, direction: 'desc' };
      return null;
    });
  }

  const columnCount = columns.length + (selectable ? 1 : 0);

  return (
    <div className="space-y-3">
      {selectable && someSelected && bulkActions ? (
        <div className="bg-muted flex items-center gap-3 rounded-md px-3 py-2">
          <span className="text-sm font-medium">
            {tCounts('selected', { count: selectedIds.size })}
          </span>
          <div className="ms-auto flex items-center gap-2">
            {bulkActions(selectedIds)}
          </div>
        </div>
      ) : null}

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
                className="text-muted-foreground h-32 text-center text-sm"
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
    </div>
  );
}
