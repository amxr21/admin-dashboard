'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChoiceCards } from '@/components/ui/choice-cards';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  CANCELLATION_REASONS,
  changeOrderStatus,
  type CancellationReason,
  type OrderDetail,
  type OrderStatus,
} from '@/lib/orders-api';

/**
 * Confirms one status move, and collects its note (and, for a cancellation,
 * its reason).
 *
 * ─── WHY A DIALOG, NOT INLINE FIELDS ─────────────────────────────────
 * The old control sat in the header's button row and grew a note field (and
 * for CANCELED, a reason select) underneath itself the moment a status was
 * picked — pushing the whole header down and leaving controls of four
 * different heights side by side. A dialog gives those fields their own room
 * and makes the move a deliberate, confirmed act, which a cancellation (final,
 * and it stops the courier) should be.
 *
 * ─── THE REASON RULES MIRROR THE SERVER'S (URG-010) ──────────────────
 * A cancellation needs a reason from the fixed catalogue, and OTHER needs a
 * description. The server enforces both; this only avoids a round trip that
 * could only fail. A reason is never sent on any other move — the route is
 * `.strict()` and refuses one.
 */

/** Delivery statuses that mean the courier's job is already over. */
const FINISHED_DELIVERY = ['DELIVERED', 'HANDED_OVER', 'CANCELED', 'RETURNED'];

interface OrderStatusDialogProps {
  order: OrderDetail;
  /** The move being confirmed. Kept while the dialog animates closed. */
  target: OrderStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (order: OrderDetail) => void;
}

export function OrderStatusDialog({
  order,
  target,
  open,
  onOpenChange,
  onChanged,
}: OrderStatusDialogProps) {
  const t = useTranslations('orders.statusControl');
  const tStatus = useTranslations('orderStatus');
  const translateError = useTranslatedApiError();
  const noteId = useId();
  const reasonLabelId = useId();
  const reasonNoteId = useId();

  const [note, setNote] = useState('');
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [reasonNote, setReasonNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;

  const isCanceling = target === 'CANCELED';
  const needsReasonNote = isCanceling && reason === 'OTHER';
  const reasonIncomplete = isCanceling && (!reason || (needsReasonNote && !reasonNote.trim()));
  const courierIsOut =
    order.assignment !== null && !FINISHED_DELIVERY.includes(order.assignment.status);

  function reset() {
    setNote('');
    setReason('');
    setReasonNote('');
    setError(null);
  }

  async function submit() {
    if (!target || reasonIncomplete) return;

    setIsSaving(true);
    setError(null);

    try {
      const updated = await changeOrderStatus(
        order.id,
        target,
        note.trim() || undefined,
        isCanceling
          ? {
              cancellationReason: reason || undefined,
              cancellationReasonNote: needsReasonNote ? reasonNote.trim() : undefined,
            }
          : undefined,
      );
      onChanged(updated);
      toast.success(t('moved', { number: order.orderNumber, status: tStatus(target) }));
      reset();
      onOpenChange(false);
    } catch (caught) {
      // Kept open with the refusal visible — the typed note isn't lost.
      setError(translateError(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isSaving) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`dialogTitles.${target}`, { number: order.orderNumber })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('dialogDescription', { from: tStatus(order.status), to: tStatus(target) })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isCanceling ? (
          <div
            role="note"
            className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md px-3 py-2 text-sm"
          >
            {/* A warning sign is universal — never mirrored. */}
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              {t('cancelFinal')}
              {courierIsOut ? <> {t('cancelCourier')}</> : null}
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="space-y-4 text-start">
          {isCanceling ? (
            <div className="space-y-2">
              <p id={reasonLabelId} className="text-sm leading-none font-medium">
                {t('cancellationReasonLabel')}
              </p>
              <ChoiceCards
                aria-labelledby={reasonLabelId}
                options={CANCELLATION_REASONS.map((value) => ({
                  value,
                  label: t(`cancellationReasons.${value}`),
                }))}
                value={reason}
                onChange={(value) => {
                  setReason(value as CancellationReason);
                  setReasonNote('');
                }}
                disabled={isSaving}
              />
            </div>
          ) : null}

          {/* The code is what reports group by; this is what a human reads.
              Only for OTHER — a note beside a catalogued reason would be a
              second, unqueryable explanation competing with the code. */}
          {needsReasonNote ? (
            <div className="space-y-2">
              <Label htmlFor={reasonNoteId}>{t('cancellationReasonNoteLabel')}</Label>
              <Textarea
                id={reasonNoteId}
                value={reasonNote}
                onChange={(event) => setReasonNote(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder={t('cancellationReasonNotePlaceholder')}
                disabled={isSaving}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={noteId}>{t('note')}</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              // Matches the column width, so the server never truncates silently.
              maxLength={255}
              placeholder={t('notePlaceholder')}
              disabled={isSaving}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSaving}>
            {isCanceling ? t('keepOrder') : t('back')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={isCanceling ? 'destructive' : 'default'}
            // Radix's Action closes on click by default — prevented so a
            // refused move keeps the dialog open with the refusal visible,
            // same as the refund dialog.
            onClick={(event) => {
              event.preventDefault();
              void submit();
            }}
            disabled={isSaving || reasonIncomplete}
          >
            {isSaving ? t('saving') : t(`actions.${target}`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
