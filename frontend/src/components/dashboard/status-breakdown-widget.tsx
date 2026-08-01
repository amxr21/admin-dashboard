'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status-badge';
import type { StatusBreakdown } from '@/lib/reports-api';

/**
 * Order outcomes for the same window — how many landed in each status. The
 * badge is the same enum → colour → label mapping used everywhere else, so a
 * cancelled order reads the same tone here as it does in the orders table.
 */

interface StatusBreakdownWidgetProps {
  data: StatusBreakdown | null;
  isLoading?: boolean;
}

export function StatusBreakdownWidget({ data, isLoading = false }: StatusBreakdownWidgetProps) {
  const t = useTranslations('reports');
  const tStates = useTranslations('states');
  const formatter = useFormatter();

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('statusBreakdown')}>
      <h2 className="text-sm font-medium">{t('statusBreakdown')}</h2>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : data && data.statuses.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {data.statuses.map((row) => (
            <li
              key={row.status}
              className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-b-0 last:pb-0"
            >
              <StatusBadge kind="orderStatus" value={row.status} />
              <span className="tabular-nums">{formatter.number(row.orders)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{tStates('empty.title')}</p>
      )}
    </section>
  );
}
