'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { refundOrder, type OrderDetail } from '@/lib/orders-api';
import { REFUND_REASONS, type RefundReason } from '@/lib/refund-reasons';

/**
 * A goodwill refund (B4.10) — money handed back with no return behind it.
 *
 * Deliberately NOT gated by the order's status or `nextStatuses` the way
 * "Request a return" is: a goodwill gesture ("we're sorry, here's your
 * money") is not the same act as taking an item back, and tying it to the
 * return transition would refuse it for exactly the orders — already
 * delivered, already closed — where a goodwill refund is most likely to be
 * the right response.
 *
 * The server caps the amount against what remains PAID (every payment row
 * summed, refunds and voids already negative), not the raw order total —
 * shown here only in the refusal message rather than pre-computed, since
 * the frontend has no payments list to compute it from client-side.
 */
interface RefundOrderDialogProps {
  order: OrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefunded: (order: OrderDetail) => void;
}

export function RefundOrderDialog({ order, open, onOpenChange, onRefunded }: RefundOrderDialogProps) {
  const t = useTranslations('orders.refund');
  const tReturn = useTranslations('returns.detail');
  const translateError = useTranslatedApiError();

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason | ''>('');
  const [reasonNote, setReasonNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAmount('');
    setReason('');
    setReasonNote('');
    setError(null);
  }

  const amountValue = Number(amount);
  const isValid =
    amount.trim() !== '' && Number.isFinite(amountValue) && amountValue > 0 &&
    reason !== '' && (reason !== 'OTHER' || reasonNote.trim() !== '');

  async function submit() {
    if (!isValid) return;

    setIsSaving(true);
    setError(null);

    try {
      if (!reason) return;
      const updated = await refundOrder(order.id, {
        amount,
        refundReason: reason,
        ...(reason === 'OTHER' ? { refundReasonNote: reasonNote.trim() } : {}),
      });
      toast.success(t('done', { amount }));
      onRefunded(updated);
      reset();
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="space-y-4 text-start">
          <div className="space-y-2">
            <Label htmlFor="refund-amount">{t('amountLabel')}</Label>
            <Input
              id="refund-amount"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              className="force-ltr"
              value={amount}
              placeholder="0.00"
              onChange={(event) => setAmount(event.target.value)}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-reason">{tReturn('refundReasonLabel')}</Label>
            <Select
              value={reason}
              onValueChange={(value) => {
                setReason(value as RefundReason);
                setReasonNote('');
              }}
              disabled={isSaving}
            >
              <SelectTrigger id="refund-reason" className="w-full">
                <SelectValue placeholder={tReturn('refundReasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {REFUND_REASONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {tReturn(`refundReasons.${item}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reason === 'OTHER' ? (
            <div className="space-y-2">
              <Label htmlFor="refund-reason-note">{tReturn('refundReasonNoteLabel')}</Label>
              <Textarea
                id="refund-reason-note"
                value={reasonNote}
                onChange={(event) => setReasonNote(event.target.value)}
                placeholder={tReturn('refundReasonNotePlaceholder')}
                maxLength={500}
                disabled={isSaving}
              />
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSaving}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            // Radix's Action closes on click by default — prevented so a
            // FAILED refund (e.g. over the cap) keeps the dialog open with
            // the refusal visible, same pattern the manager-override dialog
            // uses.
            onClick={(event) => {
              event.preventDefault();
              void submit();
            }}
            disabled={!isValid || isSaving}
          >
            {isSaving ? t('saving') : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
