'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { TrendingDown, TrendingUp } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The one hero figure on the page. Revenue outranks the other three stats —
 * it gets the biggest type on the page and the seat next to the chart,
 * instead of sitting in a row of four identical boxes.
 *
 * Per the dataviz figures spec: a standalone hero number uses proportional
 * figures, not `tabular-nums` — that's reserved for columns of aligned
 * digits, and a display-size number set in tabular figures reads loose.
 */

interface RevenueHeroProps {
  value: number;
  /** Percentage change vs the comparison period. Omit when unknown (e.g. the
   *  comparison period had zero revenue — a percentage of zero is undefined —
   *  or the comparison selector is set to "None"). */
  deltaPercent?: number;
  /** Names WHICH period the delta compares against — driven by the
   *  dashboard's comparison selector, so this must never hardcode "previous
   *  period" while showing a year-over-year number. */
  comparisonLabel?: string;
  isLoading?: boolean;
}

export function RevenueHero({
  value,
  deltaPercent,
  comparisonLabel,
  isLoading = false,
}: RevenueHeroProps) {
  const t = useTranslations('dashboard');
  const formatter = useFormatter();

  if (isLoading) {
    return (
      <div className="bg-card flex h-full flex-col justify-center rounded-lg border p-6">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="mt-4 h-11 w-40" />
      </div>
    );
  }

  const formatted = formatter.number(value, 'currency');

  return (
    <div className="bg-card flex h-full flex-col justify-center overflow-hidden rounded-lg border p-6">
      <div className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
          <TrendingUp className="size-4" aria-hidden />
        </span>
        <span className="text-muted-foreground text-sm">{t('totalRevenue')}</span>
      </div>

      {/*
       * `lg:text-5xl` (48px) on a real business's revenue figure — e.g.
       * "AED 54,412.19", 13 characters — overflowed this card's ~265px
       * inner width by ~60px. Because the card and its parent both leave
       * `overflow: visible`, that overflow didn't clip or wrap; it bled
       * onto the ADJACENT chart card and got silently painted over by its
       * opaque background — a revenue figure quietly missing its last
       * digit on screen, with nothing indicating it was cut short. Found
       * by reproducing the live dashboard rather than trusting a skeleton
       * screenshot.
       *
       * Fixed two ways: a smaller ceiling that fits real currency strings
       * at this column width, AND `overflow-hidden` + `truncate` here as a
       * deliberate, VISIBLE ellipsis fallback (never a silent one) for any
       * currency/locale combination that still doesn't fit — with the
       * full value in `title` so it's never actually lost, only elided.
       */}
      <p
        className="mt-3 truncate text-2xl font-semibold sm:text-3xl lg:text-4xl"
        title={formatted}
      >
        {formatted}
      </p>

      {deltaPercent !== undefined ? (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-xs tabular-nums',
            deltaPercent >= 0 ? 'text-success' : 'text-destructive',
          )}
        >
          {deltaPercent >= 0 ? (
            <TrendingUp className="size-3.5" aria-hidden />
          ) : (
            <TrendingDown className="size-3.5" aria-hidden />
          )}
          <span>
            {formatter.number(Math.abs(deltaPercent) / 100, {
              style: 'percent',
              maximumFractionDigits: 1,
            })}
          </span>
          <span className="text-muted-foreground">{comparisonLabel ?? t('vsPreviousPeriod')}</span>
        </p>
      ) : null}
    </div>
  );
}
