'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

export const ADVANCED_INSIGHTS_REGION_ID = 'dashboard-advanced-insights';

interface AdvancedInsightsToggleProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * One disclosure for the dashboard's secondary analysis.
 *
 * The default overview stays focused on today's operation; deeper product,
 * order-mix, returns and activity panels remain one keyboard-reachable action
 * away. Keeping the trigger as a real button with aria-expanded/controls makes
 * the simplification reversible without hiding the relationship from assistive
 * technology.
 */
export function AdvancedInsightsToggle({ open, onToggle }: AdvancedInsightsToggleProps) {
  const t = useTranslations('dashboard.advanced');

  return (
    <div className="col-span-12">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={ADVANCED_INSIGHTS_REGION_ID}
        className={cn(
          'bg-card hover:border-primary/35 focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-start shadow-xs transition-colors',
          'focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        <span
          className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg"
          aria-hidden
        >
          <SlidersHorizontal className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t('title')}</span>
          <span className="text-muted-foreground mt-0.5 block text-sm leading-snug">
            {t('description')}
          </span>
        </span>
        <span className="text-primary shrink-0 text-sm font-semibold">
          {open ? t('hide') : t('show')}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}
