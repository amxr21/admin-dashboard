'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status-badge';
import type { FulfillmentHealth } from '@/lib/reports-api';

/**
 * How long orders actually sit in PENDING/CONFIRMED, and which specific ones
 * are stuck past their SLA right now — a clickable queue, not just a count.
 * The average is real (from completed transitions, `getFulfillmentHealth` in
 * the backend); "needs attention" reflects live state, not the selected
 * report range, the same way a to-do list doesn't care what date range you're
 * looking at.
 */
interface FulfillmentHealthWidgetProps {
  data: FulfillmentHealth | null;
  isLoading?: boolean;
}

export function FulfillmentHealthWidget({ data, isLoading = false }: FulfillmentHealthWidgetProps) {
  const t = useTranslations('dashboard.fulfillment');
  const tStatus = useTranslations('states');
  // Same enum→label mapping StatusBadge uses — never a raw SCREAMING_CASE
  // value interpolated into a translated sentence.
  const tOrderStatus = useTranslations('orderStatus');

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <h2 className="text-sm font-medium">{t('title')}</h2>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : data ? (
        <div className="mt-3 space-y-4">
          <dl className="grid grid-cols-2 gap-3">
            {data.avgHoursInStatus.map((row) => (
              <div key={row.status} className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">
                  {t('avgTimeIn', { status: tOrderStatus(row.status) })}
                </dt>
                <dd className="text-sm font-medium tabular-nums">
                  {row.avgHours === null ? t('noCompletedYet') : t('hours', { count: row.avgHours })}
                </dd>
              </div>
            ))}
          </dl>

          {data.needsAttention.length > 0 ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-muted-foreground text-xs font-medium">
                {t('needsAttention', { count: data.needsAttention.length })}
              </p>
              <ul className="space-y-2">
                {data.needsAttention.slice(0, 5).map((row) => (
                  <li key={row.orderId} className="flex items-center justify-between gap-3 text-sm">
                    <Link
                      href={`/admin/orders/${row.orderId}`}
                      className="force-ltr truncate hover:underline"
                    >
                      {row.orderNumber}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusBadge kind="orderStatus" value={row.status} />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {/* Days once it crosses 48h — "3,727 hours ago" is
                            technically correct and practically unreadable. */}
                        {row.hoursInStatus >= 48
                          ? t('daysAgo', { count: Math.floor(row.hoursInStatus / 24) })
                          : t('hoursAgo', { count: row.hoursInStatus })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground border-t pt-3 text-sm">{t('allClear')}</p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{tStatus('empty.title')}</p>
      )}
    </section>
  );
}
