'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Ban, ClipboardEdit, Package, RotateCcw, Truck } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchOrderTimeline, type OrderStatus, type TimelineEvent } from '@/lib/orders-api';

/**
 * Every real event touching this order, merged and chronological (C5.4) —
 * status moves, staff edits, delivery-status pings, and return decisions.
 * "Emails sent" is deliberately absent: there is no order-lifecycle
 * customer email feature in this app to log (see orders.service.ts's
 * `getOrderTimeline` doc comment) — fabricating an entry would be worse
 * than the honest gap.
 *
 * The connecting line is drawn with `inset-inline-start`, not `left`, so the
 * rail sits on the reading-start edge in both directions. A `left` here would
 * put the Arabic timeline's spine on the wrong side of its own dots.
 *
 * Best-effort, independent of the order load itself — a failed fetch shows a
 * quiet empty state rather than blocking the rest of the detail page.
 */

interface OrderTimelineProps {
  orderId: string;
  /** The order's own creation, which precedes every recorded event. */
  placedAt: string;
}

export function OrderStatusTimeline({ orderId, placedAt }: OrderTimelineProps) {
  const t = useTranslations('orders.timeline');
  const formatter = useFormatter();

  const [events, setEvents] = useState<TimelineEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);

    fetchOrderTimeline(orderId)
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (events === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 ps-6">
      {/* The rail. aria-hidden because it carries no information the list
          items don't already state. */}
      <span className="bg-border absolute top-2 bottom-2 start-1.5 w-px" aria-hidden />

      <li className="relative">
        <Dot />
        <p className="text-sm font-medium">{t('placed')}</p>
        <time className="text-muted-foreground text-xs" dateTime={placedAt}>
          {formatter.dateTime(new Date(placedAt), 'long')}
        </time>
      </li>

      {events.map((event) => (
        <li key={event.id} className="relative">
          <Dot kind={event.kind} />
          <TimelineEventBody event={event} />
        </li>
      ))}

      {events.length === 0 ? (
        <li>
          <EmptyState title={t('noChanges')} className="py-4" />
        </li>
      ) : null}
    </ol>
  );
}

function TimelineEventBody({ event }: { event: TimelineEvent }) {
  const t = useTranslations('orders.timeline');
  const formatter = useFormatter();
  const time = (
    <time className="text-muted-foreground text-xs" dateTime={event.createdAt}>
      {formatter.dateTime(new Date(event.createdAt), 'long')}
    </time>
  );

  if (event.kind === 'status') {
    const fromStatus = event.detail.fromStatus as OrderStatus | null;
    const toStatus = event.detail.toStatus as OrderStatus;
    const note = event.detail.note as string | null;

    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {fromStatus ? (
            <>
              <StatusBadge kind="orderStatus" value={fromStatus} />
              {/* An arrow would need mirroring; "→" as text does not, and
                  the meaning is carried by the order of the badges. */}
              <span className="text-muted-foreground text-xs">{t('movedTo')}</span>
            </>
          ) : null}
          <StatusBadge kind="orderStatus" value={toStatus} />
        </div>
        {note ? <p className="mt-1 text-sm">{note}</p> : null}
        {time}
      </>
    );
  }

  if (event.kind === 'note') {
    const body = event.detail.body as string;

    return (
      <>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ClipboardEdit aria-hidden className="size-3.5" />
          {t('noteAdded', { who: event.actorName ?? t('unknownActor') })}
        </p>
        <p className="mt-1 text-sm whitespace-pre-wrap">{body}</p>
        {time}
      </>
    );
  }

  if (event.kind === 'delivery') {
    const from = event.detail.deliveryStatus as { from: string; to: string } | undefined;

    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Truck aria-hidden className="text-muted-foreground size-3.5" />
          {from ? <StatusBadge kind="deliveryStatus" value={from.to} /> : null}
          <span className="text-muted-foreground text-xs">
            {t('reportedBy', { who: event.actorName ?? t('unknownActor') })}
          </span>
        </div>
        {time}
      </>
    );
  }

  if (event.kind === 'return') {
    const status = event.detail.status as string;
    const resolution = event.detail.resolution as string;
    const rmaNumber = event.detail.rmaNumber as string;
    const isRejected = status === 'REJECTED';

    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {isRejected ? (
            <Ban aria-hidden className="text-muted-foreground size-3.5" />
          ) : (
            <RotateCcw aria-hidden className="text-muted-foreground size-3.5" />
          )}
          <span className="force-ltr text-sm font-medium">{rmaNumber}</span>
          <StatusBadge kind="returnStatus" value={status} />
          {status === 'APPROVED' ? (
            <StatusBadge kind="returnResolution" value={resolution} />
          ) : null}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('byActor', { who: event.actorName ?? t('unknownActor') })}
        </p>
        {time}
      </>
    );
  }

  // 'other' — a future AuditLog action against entity='orders' this
  // component doesn't yet have a dedicated rendering for. Degrades to the
  // raw action name rather than disappearing silently.
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Package aria-hidden className="size-3.5" />
        {event.action}
      </p>
      {time}
    </>
  );
}

function Dot({ kind }: { kind?: TimelineEvent['kind'] }) {
  return (
    <span
      className="bg-primary absolute top-1.5 start-[-1.35rem] size-2 rounded-full"
      aria-hidden
      data-kind={kind}
    />
  );
}
