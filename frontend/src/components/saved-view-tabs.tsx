'use client';

import { cn } from '@/lib/utils';

/**
 * The 3–5 filter combinations staff reach for daily, as first-class tabs —
 * e.g. Orders: All · Pending · Shipped · Delivered · Canceled.
 *
 * Deliberately NOT user-defined "save my current filters as a view". The
 * spec's own example names a small, fixed set per page, and a fixed set is a
 * complete, correct feature — a save-your-own-view system is a different,
 * considerably bigger one (naming, editing, deleting, sharing views) that
 * this component doesn't attempt.
 *
 * Each tab IS a URL state, not a separate concept layered on top of one —
 * clicking "Pending" is indistinguishable from a user who set the status
 * filter to Pending by hand, which is exactly right: the tab is a shortcut
 * into the same filter state everything else in the table already reads and
 * writes, not a second source of truth that could disagree with it.
 */

export interface SavedView<TFilters extends Record<string, string>> {
  id: string;
  label: string;
  /** The URL param values this view corresponds to. Compared structurally
   *  against the table's CURRENT filter values to decide which tab is
   *  active — there is no separate "which view is selected" state. */
  filters: TFilters;
}

interface SavedViewTabsProps<TFilters extends Record<string, string>> {
  views: readonly SavedView<TFilters>[];
  /** The table's current filter values, same keys as each view's `filters`. */
  currentFilters: TFilters;
  onSelect: (filters: TFilters) => void;
  className?: string;
}

export function SavedViewTabs<TFilters extends Record<string, string>>({
  views,
  currentFilters,
  onSelect,
  className,
}: SavedViewTabsProps<TFilters>) {
  return (
    <div role="tablist" className={cn('flex flex-wrap gap-1', className)}>
      {views.map((view) => {
        const isActive = (Object.keys(view.filters) as (keyof TFilters)[]).every(
          (key) => (currentFilters[key] ?? '') === (view.filters[key] ?? ''),
        );

        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(view.filters)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
