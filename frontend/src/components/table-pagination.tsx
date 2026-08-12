'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The pagination footer, shared by every list page.
 *
 * Seven tables had hand-written copies of the same prev/next pair, which is
 * why none of them offered a page-size control: adding one meant editing seven
 * files and keeping them consistent by hand. One component, one place.
 *
 * ## Why the page-size selector is here rather than only in Settings
 *
 * `dashboard.tablePageSize` is a real setting and stays the default. But it is
 * store-wide and needs a round-trip to change, which is the wrong shape for
 * "show me more rows for the next thirty seconds while I scan this list". The
 * selector overrides the default for the current view only, in the URL, so it
 * is shareable and disappears on the next visit.
 *
 * ## Why it renders even on a single page
 *
 * The old footer hid entirely when `totalPages <= 1`, which is defensible for
 * prev/next but wrong for the size control: a list showing 20 of 23 rows looks
 * complete, and the only way to discover it isn't is a control that is visible
 * BEFORE you need it. The prev/next pair still hides when there is one page.
 */

/** Powers of roughly 2.5 — enough separation that each step is a real choice. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

interface TablePaginationProps {
  page: number;
  totalPages: number;
  /** Total matching rows, not rows on this page. */
  total: number;
  pageSize: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  /** Omit to hide the size selector (a fixed-size list, e.g. a preview). */
  onPageSizeChange?: (pageSize: number) => void;
  /** Rendered instead of the default "N results" line. */
  totalLabel?: string;
}

export function TablePagination({
  page,
  totalPages,
  total,
  pageSize,
  isLoading = false,
  onPageChange,
  onPageSizeChange,
  totalLabel,
}: TablePaginationProps) {
  const t = useTranslations('table');
  const tCounts = useTranslations('counts');

  // Nothing to page and nothing to resize — an empty or errored table gets a
  // clean footer rather than "0 results · Page 1 of 0".
  if (total === 0) return null;

  const showSteppers = totalPages > 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-muted-foreground text-sm tabular-nums">
        {totalLabel ?? tCounts('results', { count: total })}
      </p>

      <div className="flex items-center gap-4">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            <label
              htmlFor="table-page-size"
              className="text-muted-foreground text-sm whitespace-nowrap"
            >
              {t('rowsPerPage')}
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger id="table-page-size" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {showSteppers ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              {t('previous')}
            </Button>
            <span className="text-sm tabular-nums">
              {t('pageOf', { page, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            >
              {t('next')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
