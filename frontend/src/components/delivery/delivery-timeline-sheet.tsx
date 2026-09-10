'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CircleDot, PencilLine, RefreshCw, Truck } from 'lucide-react';

import { ErrorSection } from '@/components/errors/error-section';
import { StatusBadge } from '@/components/status-badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchDeliveryTimeline,
  type DeliveryBoardAssignment,
  type DeliveryStatus,
  type DeliveryTimelineEvent,
  type DeliveryTimelineResult,
} from '@/lib/delivery-api';

interface DeliveryTimelineSheetProps {
  assignment: DeliveryBoardAssignment | null;
  onOpenChange: (open: boolean) => void;
}

export function DeliveryTimelineSheet({
  assignment,
  onOpenChange,
}: DeliveryTimelineSheetProps) {
  const t = useTranslations('delivery.timeline');
  const translateError = useTranslatedApiError();
  const [result, setResult] = useState<DeliveryTimelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!assignment) {
      setResult(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setResult(null);
    setError(null);

    fetchDeliveryTimeline(assignment.id)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [assignment, reloadKey, translateError]);

  const orderNumber = assignment?.order.orderNumber ?? '';

  return (
    <Sheet open={assignment !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        title={t('title', { order: orderNumber })}
        description={t('description')}
        className="max-w-lg overflow-y-auto"
      >
        <header>
          <h2 className="text-lg font-semibold">
            {t('title', { order: orderNumber })}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
        </header>

        {error ? (
          <ErrorSection
            title={t('loadFailed')}
            description={error}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : result === null ? (
          <div className="space-y-3" aria-label={t('loading')}>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <ol className="relative space-y-5 ps-7">
            <span
              className="bg-border absolute top-2 bottom-2 start-2 w-px"
              aria-hidden
            />
            {result.events.map((event) => (
              <li key={event.id} className="relative">
                <span
                  className="bg-primary absolute top-2 start-[-1.45rem] size-2.5 rounded-full"
                  aria-hidden
                />
                <DeliveryTimelineEventBody event={event} />
              </li>
            ))}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}

function statusChange(event: DeliveryTimelineEvent): DeliveryStatus | null {
  const deliveryStatus = event.detail.deliveryStatus;
  if (deliveryStatus && typeof deliveryStatus === 'object' && 'to' in deliveryStatus) {
    return String(deliveryStatus.to) as DeliveryStatus;
  }

  const status = event.detail.status;
  if (status && typeof status === 'object' && 'to' in status) {
    return String(status.to) as DeliveryStatus;
  }
  if (typeof status === 'string') return status as DeliveryStatus;
  return null;
}

function DeliveryTimelineEventBody({ event }: { event: DeliveryTimelineEvent }) {
  const t = useTranslations('delivery.timeline');
  const formatter = useFormatter();
  const status = statusChange(event);
  const Icon =
    event.action === 'delivery.assignment.reassigned'
      ? RefreshCw
      : event.action === 'delivery.assignment.details_updated'
        ? PencilLine
        : event.action === 'delivery.assignment.status_changed'
          ? CircleDot
          : Truck;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="text-muted-foreground size-4" aria-hidden />
        <p className="text-sm font-medium">{t(`actions.${actionKey(event.action)}`)}</p>
        {status ? <StatusBadge kind="deliveryStatus" value={status} /> : null}
      </div>
      {event.actorName ? (
        <p className="text-muted-foreground text-xs">
          {t('byActor', { actor: event.actorName })}
        </p>
      ) : null}
      <time className="text-muted-foreground block text-xs" dateTime={event.createdAt}>
        {formatter.dateTime(new Date(event.createdAt), 'long')}
      </time>
    </div>
  );
}

function actionKey(action: DeliveryTimelineEvent['action']) {
  switch (action) {
    case 'delivery.assignment.reassigned':
      return 'reassigned';
    case 'delivery.assignment.details_updated':
      return 'detailsUpdated';
    case 'delivery.assignment.status_changed':
      return 'statusChanged';
    default:
      return 'assigned';
  }
}
