'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  CANCELLATION_REASONS,
  changeOrderStatus,
  type CancellationReason,
  type OrderDetail,
  type OrderStatus,
} from '@/lib/orders-api';

/**
 * Moves an order to its next status.
 *
 * ─── THE OPTIONS COME FROM THE SERVER ────────────────────────────────
 * `nextStatuses` is computed from the transition table in orders.config.ts and
 * sent with the order. Keeping a second copy of that table here would mean two
 * sources of truth that drift, and the drift shows up as a button that looks
 * legal and returns 400. An illegal move is simply never offered.
 *
 * When the list is empty the order is terminal, so the control renders nothing
 * at all rather than a disabled dropdown — a dead control is noise.
 */

interface OrderStatusControlProps {
  orderId: string;
  status: OrderStatus;
  nextStatuses: OrderStatus[];
  onChanged: (order: OrderDetail) => void;
}

export function OrderStatusControl({
  orderId,
  status,
  nextStatuses,
  onChanged,
}: OrderStatusControlProps) {
  const t = useTranslations('orders.statusControl');
  const tStatus = useTranslations('orderStatus');
  const translateError = useTranslatedApiError();

  const [target, setTarget] = useState<OrderStatus | ''>('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * URG-010 — a cancellation records WHY, from a fixed catalogue.
   *
   * Only ever sent when the target is CANCELED: the server refuses a reason on
   * any other transition, since a cancellation reason on a SHIPPED move would
   * be a stored fact that never happened.
   */
  const [cancellationReason, setCancellationReason] = useState<CancellationReason | ''>('');
  const [cancellationReasonNote, setCancellationReasonNote] = useState('');

  const isCanceling = target === 'CANCELED';
  const needsReasonNote = isCanceling && cancellationReason === 'OTHER';
  // Mirrors the server's own rule rather than replacing it — the server is
  // still the authority, this only avoids an avoidable round trip.
  const reasonIncomplete =
    isCanceling && (!cancellationReason || (needsReasonNote && !cancellationReasonNote.trim()));

  if (nextStatuses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('terminal', { status: tStatus(status) })}
      </p>
    );
  }

  async function submit() {
    if (!target) return;

    setIsSaving(true);
    setError(null);

    try {
      onChanged(
        await changeOrderStatus(
          orderId,
          target,
          note.trim() || undefined,
          target === 'CANCELED'
            ? {
                cancellationReason: cancellationReason || undefined,
                cancellationReasonNote: cancellationReasonNote.trim() || undefined,
              }
            : undefined,
        ),
      );
      setTarget('');
      setNote('');
      setCancellationReason('');
      setCancellationReasonNote('');
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="w-44 space-y-2">
          <Label htmlFor="order-next-status">{t('label')}</Label>
          <Select value={target} onValueChange={(value) => setTarget(value as OrderStatus)}>
            <SelectTrigger id="order-next-status">
              <SelectValue placeholder={t('placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {nextStatuses.map((next) => (
                <SelectItem key={next} value={next}>
                  {tStatus(next)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          disabled={!target || isSaving || reasonIncomplete}
          onClick={() => void submit()}
        >
          {isSaving ? t('saving') : t('apply')}
        </Button>
      </div>

      {isCanceling ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="order-cancellation-reason">{t('cancellationReasonLabel')}</Label>
            <Select
              value={cancellationReason}
              onValueChange={(value) => setCancellationReason(value as CancellationReason)}
            >
              <SelectTrigger id="order-cancellation-reason" className="w-64">
                <SelectValue placeholder={t('cancellationReasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {CANCELLATION_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {t(`cancellationReasons.${reason}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The code is what reports group by; this is what a human reads.
              Only for OTHER — a note beside a catalogued reason would be a
              second, unqueryable explanation competing with the code. */}
          {needsReasonNote ? (
            <div className="space-y-1">
              <Label htmlFor="order-cancellation-reason-note">
                {t('cancellationReasonNoteLabel')}
              </Label>
              <Textarea
                id="order-cancellation-reason-note"
                value={cancellationReasonNote}
                onChange={(event) => setCancellationReasonNote(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder={t('cancellationReasonNotePlaceholder')}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {target ? (
        <div className="space-y-1">
          <Label htmlFor="order-status-note">{t('note')}</Label>
          <Textarea
            id="order-status-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            // Matches the column width, so the server never truncates silently.
            maxLength={255}
            placeholder={t('notePlaceholder')}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
