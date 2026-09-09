'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DoorOpen, HandCoins, PiggyBank } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { recordTillEvent, type TillEventType } from '@/lib/shifts-api';

/**
 * No-sale, cash drop, payout (O9 Tier 4).
 *
 * Lives on the SHIFT page, not the till — these are drawer events, not
 * sales, and the shift is what actually owns the drawer (`Shift.openingFloat`
 * is the same object as a till session, per the owner's O5.1 answer). Only
 * shown when the shift HAS a drawer at all — a picker's shift with no till
 * has nothing to drop cash from.
 */
interface TillEventControlsProps {
  shiftId: string;
}

const TYPES: { type: TillEventType; needsAmount: boolean }[] = [
  { type: 'NO_SALE', needsAmount: false },
  { type: 'CASH_DROP', needsAmount: true },
  { type: 'PAYOUT', needsAmount: true },
];

export function TillEventControls({ shiftId }: TillEventControlsProps) {
  const t = useTranslations('shifts.tillEvents');
  const translateError = useTranslatedApiError();

  const [openType, setOpenType] = useState<TillEventType | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAmount('');
    setNote('');
    setError(null);
  }

  async function confirm() {
    if (!openType) return;

    const needsAmount = TYPES.find((entry) => entry.type === openType)?.needsAmount ?? false;

    if (needsAmount && amount.trim() === '') return;

    setIsBusy(true);
    setError(null);

    try {
      await recordTillEvent(shiftId, {
        type: openType,
        ...(needsAmount ? { amount: amount.trim() } : {}),
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      });
      toast.success(t(`logged.${openType}`));
      reset();
      setOpenType(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenType('NO_SALE')}
          className="flex-col gap-1 py-3"
        >
          <DoorOpen className="size-4" aria-hidden />
          <span className="text-xs">{t('noSale')}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenType('CASH_DROP')}
          className="flex-col gap-1 py-3"
        >
          <PiggyBank className="size-4" aria-hidden />
          <span className="text-xs">{t('cashDrop')}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenType('PAYOUT')}
          className="flex-col gap-1 py-3"
        >
          <HandCoins className="size-4" aria-hidden />
          <span className="text-xs">{t('payout')}</span>
        </Button>
      </div>

      <AlertDialog
        open={openType !== null}
        onOpenChange={(open) => {
          if (!open) {
            reset();
            setOpenType(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{openType ? t(`titles.${openType}`) : ''}</AlertDialogTitle>
          </AlertDialogHeader>

          <div className="space-y-4 text-start">
            {openType !== 'NO_SALE' ? (
              <div className="space-y-2">
                <Label htmlFor="till-event-amount">{t('amountLabel')}</Label>
                <Input
                  id="till-event-amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="force-ltr"
                  autoFocus
                  disabled={isBusy}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="till-event-note">{t('noteLabel')}</Label>
              <Input
                id="till-event-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('notePlaceholder')}
                disabled={isBusy}
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
              >
                {error}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              // Radix's Action closes on click by default — prevented so a
              // refusal (e.g. a missing amount rejected server-side) keeps
              // the dialog open, same discipline as every other till confirm.
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
              disabled={
                isBusy ||
                (openType !== 'NO_SALE' && amount.trim() === '')
              }
            >
              {isBusy ? t('logging') : t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
