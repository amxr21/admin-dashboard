'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Ban, Package, RotateCcw, ShoppingBag, Truck, UserRound } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { initialsOf } from '@/lib/initials';
import {
  fetchOrderTimeline,
  type OrderStatus,
  type TimelineEvent,
  type TimelineEventKind,
} from '@/lib/orders-api';

/**
 * Every real event touching this order, merged, NEWEST FIRST (C5.4) — status
 * moves, staff notes, delivery-status pings, and return decisions. "Emails
 * sent" is deliberately absent: there is no order-lifecycle customer email
 * feature in this app to log (see orders.service.ts's `getOrderTimeline` doc
 * comment) — fabricating an entry would be worse than the honest gap.
 *
 * ─── ORDER ───────────────────────────────────────────────────────────
 * The API sends events newest first. "Order placed" is the oldest fact there
 * is, so it closes the list. (It used to open it, directly above the NEWEST
 * event, so the list read placed → newest → … → oldest.)
 *
 * ─── STAYS CURRENT ───────────────────────────────────────────────────
 * `refreshKey` changes whenever the page's copy of the order changes (a status
 * move, a new note, a courier update), and the feed refetches. It used to
 * fetch once per order id, so a move made on this page never appeared in its
 * own history until a reload. The previous events stay on screen during the
 * refetch, so adding a note never flashes the list back to a skeleton.
 *
 * The rail is drawn inside each row's own marker column, so it sits on the
 * reading-start side in both directions with no `left`/`right` anywhere.
 *
 * Best-effort, independent of the order load itself — a failed fetch shows a
 * quiet empty state rather than blocking the rest of the detail page.
 */

export type ActivityFilter = 'all' | 'status' | 'notes' | 'delivery';

const FILTER_KINDS: Record<Exclude<ActivityFilter, 'all'>, TimelineEventKind[]> = {
  // A return decision is part of the order's lifecycle, so it reads with status.
  status: ['status', 'return'],
  notes: ['note'],
  delivery: ['delivery'],
};

interface OrderTimelineProps {
  orderId: string;
  /** The order's own creation, which precedes every recorded event. */
  placedAt: string;
  /** Anything that changes when the order does — the feed refetches on change. */
  refreshKey?: string;
  filter?: ActivityFilter;
}

export function OrderStatusTimeline({
  orderId,
  placedAt,
  refreshKey,
  filter = 'all',
}: OrderTimelineProps) {
  const t = useTranslations('orders.timeline');
  const tNotes = useTranslations('orders.notes');
  const tActivity = useTranslations('orders.activity');

  const [events, setEvents] = useState<TimelineEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchOrderTimeline(orderId)
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch(() => {
        // A failed REFRESH keeps what is already on screen; only a failed
        // first load falls back to the empty state.
        if (!cancelled) setEvents((current) => current ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, refreshKey]);

  if (events === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const shown =
    filter === 'all' ? events : events.filter((event) => FILTER_KINDS[filter].includes(event.kind));
  const showPlaced = filter === 'all' || filter === 'status';

  if (shown.length === 0 && !showPlaced) {
    return (
      <EmptyState
        title={filter === 'notes' ? tNotes('empty') : tActivity('noMatches')}
        className="py-4"
      />
    );
  }

  return (
    <div>
      <ol>
        {shown.map((event, index) => (
          <FeedRow
            key={event.id}
            marker={<EventMarker event={event} />}
            time={event.createdAt}
            isLast={!showPlaced && index === shown.length - 1}
          >
            <TimelineEventBody event={event} />
          </FeedRow>
        ))}

        {showPlaced ? (
          <FeedRow
            marker={
              <MarkerCircle>
                <ShoppingBag aria-hidden className="size-3.5" />
              </MarkerCircle>
            }
            time={placedAt}
            isLast
          >
            <p className="text-sm font-medium">{t('placed')}</p>
          </FeedRow>
        ) : null}
      </ol>

      {filter === 'all' && events.length === 0 ? (
        <EmptyState title={t('noChanges')} className="py-4" />
      ) : null}
    </div>
  );
}

function FeedRow({
  marker,
  time,
  isLast,
  children,
}: {
  marker: ReactNode;
  time: string;
  isLast: boolean;
  children: ReactNode;
}) {
  const formatter = useFormatter();

  return (
    <li className="flex gap-3">
      <div className="flex shrink-0 flex-col items-center">
        {marker}
        {isLast ? null : <span aria-hidden className="bg-border my-1 w-px flex-1" />}
      </div>
      <div className={isLast ? 'min-w-0 flex-1' : 'min-w-0 flex-1 pb-5'}>
        <div className="flex min-h-7 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 pt-1">{children}</div>
          <time className="text-muted-foreground shrink-0 pt-1.5 text-xs" dateTime={time}>
            {formatter.dateTime(new Date(time), { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        </div>
      </div>
    </li>
  );
}

function MarkerCircle({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'person';
}) {
  return (
    <span
      className={
        tone === 'person'
          ? 'bg-primary/10 text-primary-strong flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold'
          : 'bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full'
      }
    >
      {children}
    </span>
  );
}

function EventMarker({ event }: { event: TimelineEvent }) {
  if (event.kind === 'note') {
    return (
      <MarkerCircle tone="person">
        {event.actorName ? (
          <span aria-hidden>{initialsOf(event.actorName)}</span>
        ) : (
          <UserRound aria-hidden className="size-3.5" />
        )}
      </MarkerCircle>
    );
  }

  const icon =
    event.kind === 'delivery' ? (
      // A truck implies travel, so it points the reading way.
      <Truck aria-hidden className="size-3.5 rtl:-scale-x-100" />
    ) : event.kind === 'return' ? (
      event.detail.status === 'REJECTED' ? (
        <Ban aria-hidden className="size-3.5" />
      ) : (
        <RotateCcw aria-hidden className="size-3.5" />
      )
    ) : (
      <Package aria-hidden className="size-3.5" />
    );

  return <MarkerCircle>{icon}</MarkerCircle>;
}

function TimelineEventBody({ event }: { event: TimelineEvent }) {
  const t = useTranslations('orders.timeline');
  const who = event.actorName ?? t('unknownActor');

  if (event.kind === 'status') {
    const fromStatus = event.detail.fromStatus as OrderStatus | null;
    const toStatus = event.detail.toStatus as OrderStatus;
    const note = event.detail.note as string | null;

    return (
      <>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {fromStatus ? (
            <>
              <StatusBadge kind="orderStatus" value={fromStatus} />
              {/* An arrow would need mirroring; "moved to" as text does not,
                  and the meaning is carried by the order of the badges. */}
              <span className="text-muted-foreground text-xs">{t('movedTo')}</span>
            </>
          ) : null}
          <StatusBadge kind="orderStatus" value={toStatus} />
          <span className="text-muted-foreground text-xs">
            <bdi>{t('byActor', { who })}</bdi>
          </span>
        </div>
        {note ? <NoteBubble>{note}</NoteBubble> : null}
      </>
    );
  }

  if (event.kind === 'note') {
    return (
      <>
        <p className="text-sm font-medium">{t('noteAdded', { who })}</p>
        <NoteBubble>{event.detail.body as string}</NoteBubble>
      </>
    );
  }

  if (event.kind === 'delivery') {
    const change = event.detail.deliveryStatus as { from: string; to: string } | undefined;

    return (
      <div className="flex flex-wrap items-center gap-2">
        {change ? <StatusBadge kind="deliveryStatus" value={change.to} /> : null}
        <span className="text-muted-foreground text-xs">{t('reportedBy', { who })}</span>
      </div>
    );
  }

  if (event.kind === 'return') {
    const status = event.detail.status as string;
    const resolution = event.detail.resolution as string;
    const rmaNumber = event.detail.rmaNumber as string;

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="force-ltr text-sm font-medium">{rmaNumber}</span>
        <StatusBadge kind="returnStatus" value={status} />
        {status === 'APPROVED' ? <StatusBadge kind="returnResolution" value={resolution} /> : null}
        <span className="text-muted-foreground text-xs">{t('byActor', { who })}</span>
      </div>
    );
  }

  // 'other' — a future AuditLog action against entity='orders' this
  // component doesn't yet have a dedicated rendering for. Degrades to the
  // raw action name rather than disappearing silently.
  return <p className="text-sm font-medium">{event.action}</p>;
}

/** Staff-typed text: kept as written, direction detected per note. */
function NoteBubble({ children }: { children: string }) {
  return (
    <p className="bg-muted mt-1.5 rounded-md px-3 py-2 text-sm whitespace-pre-wrap">
      <bdi dir="auto">{children}</bdi>
    </p>
  );
}
