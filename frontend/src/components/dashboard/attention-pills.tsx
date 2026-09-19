'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { NeedsAttention } from '@/lib/reports-api';

/**
 * What is blocking work right now, as a row of clickable counts.
 *
 * ─── THIS ENDPOINT EXISTED FOR MONTHS WITH NO CALLER ─────────────────
 * `/reports/needs-attention` was implemented, guarded, routed and typed —
 * and nothing in the frontend imported it. Every queue below was already
 * being computed on request and thrown away.
 *
 * ─── COUNTS ARE HONEST, NOT CAPPED ───────────────────────────────────
 * The backend counts each queue with its own query rather than taking
 * `.length` of the capped item list, so a backlog of 40 returns reports 40
 * and not the 20 it happens to have fetched. That distinction is the whole
 * reason this is worth showing, so the UI must not undo it by counting items.
 *
 * ─── OUT OF STOCK WITH OPEN ORDERS LEADS ─────────────────────────────
 * It is the only queue here that means a promise has already been broken —
 * something was sold that cannot be shipped. The others are work waiting;
 * this one is work that has already gone wrong, so it sorts first and is the
 * only one that takes the destructive tone.
 */

interface AttentionPillsProps {
  data: NeedsAttention | null;
  isLoading?: boolean;
}

export function AttentionPills({ data, isLoading = false }: AttentionPillsProps) {
  const t = useTranslations('dashboard.attention');

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-44 rounded-full" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const queues = [
    {
      key: 'outOfStock',
      count: data.outOfStockWithOpenOrders.count,
      href: '/admin/inventory?lowStock=true',
      severe: true,
    },
    {
      key: 'unassigned',
      count: data.unassignedDeliveries.count,
      href: '/admin/delivery',
      severe: false,
    },
    {
      key: 'returns',
      count: data.returnsAwaitingApproval.count,
      href: '/admin/returns?status=REQUESTED',
      severe: false,
    },
    {
      key: 'reviews',
      count: data.reviewsAwaitingModeration.count,
      href: '/admin/r/reviews?status=PENDING',
      severe: false,
    },
  ];

  const outstanding = queues.reduce((sum, queue) => sum + queue.count, 0);

  /**
   * The strongest thing a dashboard can say. An owner opening this after a
   * weekend should be able to learn "nothing is waiting" without reading four
   * zeroes and inferring it.
   */
  if (outstanding === 0) {
    return (
      <p className="text-muted-foreground inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3.5 py-2 text-sm">
        <CheckCircle2
          className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
          aria-hidden
        />
        <span className="text-foreground font-medium">{t('allClear')}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('label')}>
      {queues.map((queue) => (
        <Link
          key={queue.key}
          href={queue.href}
          className={cn(
            'bg-card hover:border-ring inline-flex items-center gap-2 rounded-full border py-1.5 ps-1.5 pe-3.5 text-sm shadow-xs transition-colors',
            // A cleared queue stays on screen rather than disappearing: its
            // absence and its zero are different messages, and "0 reviews to
            // moderate" is the one that says the check was actually made.
            queue.count === 0 && 'text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold text-white tabular-nums',
              queue.count === 0
                ? 'bg-emerald-600'
                : queue.severe
                  ? 'bg-destructive'
                  : 'bg-amber-600',
            )}
          >
            {queue.count}
          </span>
          {/* The icon carries severity alongside the colour, never instead of
              it — red and amber are indistinguishable to some readers. */}
          {queue.count > 0 && queue.severe ? (
            <AlertTriangle className="text-destructive size-3.5 shrink-0" aria-hidden />
          ) : null}
          {t(`queues.${queue.key}`)}
        </Link>
      ))}
    </div>
  );
}
