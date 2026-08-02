'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import type { OrderValueDistribution } from '@/lib/reports-api';

/**
 * Order-value distribution — a histogram, not just the average order value.
 * Single series describing one measure (order count) across buckets of the
 * SAME thing (order value), so one hue is correct here — this isn't a
 * categorical-identity chart, it's a magnitude-by-bucket one.
 */
interface OrderValueWidgetProps {
  data: OrderValueDistribution | null;
  isLoading?: boolean;
}

export function OrderValueWidget({ data, isLoading = false }: OrderValueWidgetProps) {
  const t = useTranslations('dashboard.orderValue');
  const tStatus = useTranslations('states');
  const formatter = useFormatter();

  const max = data ? Math.max(1, ...data.buckets.map((bucket) => bucket.count)) : 1;

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <h2 className="text-sm font-medium">{t('title')}</h2>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      ) : data && data.buckets.some((bucket) => bucket.count > 0) ? (
        <ul className="mt-3 space-y-2">
          {data.buckets.map((bucket) => (
            <li key={bucket.label} className="flex items-center gap-3 text-sm">
              <span className="force-ltr text-muted-foreground w-20 shrink-0 tabular-nums whitespace-nowrap">
                {bucket.label}
              </span>
              <span className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
                <span
                  className="bg-primary block h-full rounded-full"
                  style={{ width: `${String((bucket.count / max) * 100)}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-end tabular-nums">
                {formatter.number(bucket.count)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{tStatus('empty.title')}</p>
      )}
    </section>
  );
}
