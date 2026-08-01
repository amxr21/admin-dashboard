'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

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
  isLoading?: boolean;
}

export function RevenueHero({ value, isLoading = false }: RevenueHeroProps) {
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

  return (
    <div className="bg-card flex h-full flex-col justify-center rounded-lg border p-6">
      <div className="flex items-center gap-2">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
          <TrendingUp className="size-4" aria-hidden />
        </span>
        <span className="text-muted-foreground text-sm">{t('totalRevenue')}</span>
      </div>

      <p className="mt-3 text-3xl font-semibold sm:text-4xl lg:text-5xl">
        {formatter.number(value, 'currency')}
      </p>
    </div>
  );
}
