'use client';

import { useTranslations } from 'next-intl';
import { FilterX, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The applied-filter summary, shared by every list page.
 *
 * Two jobs. First, it states in ONE place everything currently narrowing the
 * result — a Select reading "PUBLISHED" three controls away from the table is
 * easy to miss, and "why is this list empty?" is usually a filter someone
 * forgot was set. Second, it makes each filter individually undoable without
 * hunting for the control that set it.
 *
 * Extracted rather than copied: this is the third table to need it, and the
 * spec's cross-page consistency contract asks for one chip pattern and one
 * clear-all, not one per page.
 *
 * Callers pass the filters that are ACTIVE. Rendering nothing when the list is
 * empty is deliberate — an always-present "Filters:" label with no chips reads
 * as a broken control rather than a clean slate.
 */

export interface AppliedFilter {
  /** Stable key, used for React identity. Usually the field name. */
  id: string;
  /** Human-readable, already translated and already including its value. */
  label: string;
  onRemove: () => void;
}

interface FilterChipsProps {
  filters: readonly AppliedFilter[];
  /** Omit to hide the clear-all control (a single-filter page doesn't need it). */
  onClearAll?: () => void;
  className?: string;
}

export function FilterChips({ filters, onClearAll, className }: FilterChipsProps) {
  const t = useTranslations('filters');

  if (filters.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">{t('applied')}</span>

        {filters.map((filter) => (
          <span
            key={filter.id}
            className="bg-muted inline-flex items-center gap-1 rounded-full py-1 ps-3 pe-1 text-sm"
          >
            <span className="max-w-48 truncate">{filter.label}</span>
            {/* A real nested button, not a click handler on the chip: the chip
                itself isn't interactive, and making the whole thing clickable
                would give keyboard users a focus target whose only action is
                destructive, with no visual distinction between "the chip" and
                "remove the chip". */}
            <button
              type="button"
              onClick={filter.onRemove}
              aria-label={t('remove', { label: filter.label })}
              className="hover:bg-background focus-visible:ring-ring rounded-full p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {/* An X is symmetric — never .icon-directional. */}
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}

        {onClearAll ? (
          <Button variant="ghost" size="sm" onClick={onClearAll}>
            <FilterX aria-hidden />
            {t('clearAll')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
