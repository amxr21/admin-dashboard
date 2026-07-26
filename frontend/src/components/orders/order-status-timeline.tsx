'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { StatusBadge } from '@/components/status-badge';
import type { OrderStatusEntry } from '@/lib/orders-api';

/**
 * What happened to this order, in order.
 *
 * The connecting line is drawn with `inset-inline-start`, not `left`, so the
 * rail sits on the reading-start edge in both directions. A `left` here would
 * put the Arabic timeline's spine on the wrong side of its own dots.
 */

interface OrderStatusTimelineProps {
  entries: OrderStatusEntry[];
  /** The order's own creation, which precedes the first recorded move. */
  placedAt: string;
}

export function OrderStatusTimeline({ entries, placedAt }: OrderStatusTimelineProps) {
  const t = useTranslations('orders.timeline');
  const formatter = useFormatter();

  return (
    <ol className="relative space-y-4 ps-6">
      {/* The rail. aria-hidden because it carries no information the list
          items don't already state. */}
      <span
        className="bg-border absolute inset-block-2 inset-inline-start-1.5 w-px"
        aria-hidden
      />

      <li className="relative">
        <Dot />
        <p className="text-sm font-medium">{t('placed')}</p>
        <time className="text-muted-foreground text-xs" dateTime={placedAt}>
          {formatter.dateTime(new Date(placedAt), 'long')}
        </time>
      </li>

      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <Dot />
          <div className="flex flex-wrap items-center gap-2">
            {entry.fromStatus ? (
              <>
                <StatusBadge kind="orderStatus" value={entry.fromStatus} />
                {/* An arrow would need mirroring; "→" as text does not, and
                    the meaning is carried by the order of the badges. */}
                <span className="text-muted-foreground text-xs">{t('movedTo')}</span>
              </>
            ) : null}
            <StatusBadge kind="orderStatus" value={entry.toStatus} />
          </div>

          {entry.note ? <p className="mt-1 text-sm">{entry.note}</p> : null}

          <time className="text-muted-foreground text-xs" dateTime={entry.createdAt}>
            {formatter.dateTime(new Date(entry.createdAt), 'long')}
          </time>
        </li>
      ))}

      {entries.length === 0 ? (
        <li className="text-muted-foreground text-sm">{t('noChanges')}</li>
      ) : null}
    </ol>
  );
}

function Dot() {
  return (
    <span
      className="bg-primary absolute top-1.5 inset-inline-start-[-1.35rem] size-2 rounded-full"
      aria-hidden
    />
  );
}
