'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, LogIn, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { elapsedLabel, useShiftClock } from '@/hooks/useShiftClock';
import { TillEventControls } from '@/components/pos/till-event-controls';

/**
 * The interactive clock (owner's note, 2026-09-09).
 *
 * Reuses `useShiftClock` — the topbar indicator (`shift-control.tsx`) and
 * the till's own onboarding gate (`sale-screen.tsx`) share the exact same
 * logic, so a fix here cannot drift from either.
 */
export function ShiftClockScreen() {
  const t = useTranslations('shifts');
  const {
    shift,
    isReady,
    isBusy,
    variance,
    dismissVariance,
    start,
    finish,
    fetchExpectedCash,
  } = useShiftClock();

  const [openingFloat, setOpeningFloat] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [closingCount, setClosingCount] = useState('');
  const [expectedCash, setExpectedCash] = useState<string | null>(null);

  async function openEndDialog() {
    setConfirmEnd(true);
    setExpectedCash(await fetchExpectedCash());
  }

  async function handleFinish() {
    await finish(closingCount);
    setClosingCount('');
    setConfirmEnd(false);
  }

  if (!isReady) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border p-8 text-center">
        <Skeleton className="mx-auto h-16 w-40" />
        <Skeleton className="mx-auto h-10 w-32" />
      </div>
    );
  }

  if (shift === null) {
    return (
      <div className="mx-auto max-w-md space-y-6 rounded-lg border p-8 text-center">
        {variance !== null ? (
          <div className="bg-muted space-y-1 rounded-md p-3">
            <p className="text-muted-foreground text-sm">{t('lastTillVariance')}</p>
            <p className="text-lg font-semibold tabular-nums">
              {t('varianceShort', { variance })}
            </p>
            <Button variant="ghost" size="sm" onClick={dismissVariance}>
              {t('dismiss')}
            </Button>
          </div>
        ) : null}

        <div className="space-y-1">
          <Clock className="text-muted-foreground mx-auto size-10" aria-hidden />
          <p className="text-lg font-medium">{t('notOnShift')}</p>
        </div>

        <div className="space-y-2 text-start">
          <Label htmlFor="shift-page-float">{t('openingFloat')}</Label>
          {/* Optional on purpose: most shifts have no till, and forcing a 0
              would make "no drawer" indistinguishable from "an empty one". */}
          <Input
            id="shift-page-float"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
            placeholder={t('floatPlaceholder')}
            inputMode="decimal"
            className="force-ltr"
            disabled={isBusy}
          />
          <p className="text-muted-foreground text-xs">{t('floatHint')}</p>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={() => void start(openingFloat).then(() => setOpeningFloat(''))}
          disabled={isBusy}
        >
          <LogIn className="size-4" aria-hidden />
          {t('start')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-lg border p-8 text-center">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">{shift.branch.name}</p>
        <p className="text-6xl font-semibold tabular-nums" aria-live="polite">
          {elapsedLabel(shift.startedAt)}
        </p>
        <p className="text-muted-foreground text-xs">{t('elapsedHint')}</p>
      </div>

      {shift.openingFloat !== null ? (
        <>
          <p className="text-muted-foreground text-sm">
            {t('floatOnRecord', { float: shift.openingFloat })}
          </p>
          <TillEventControls shiftId={shift.id} />
        </>
      ) : null}

      <Button
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => void openEndDialog()}
        disabled={isBusy}
      >
        <LogOut className="size-4" aria-hidden />
        {t('end')}
      </Button>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('endTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('endBody', { elapsed: elapsedLabel(shift.startedAt), branch: shift.branch.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {shift.openingFloat !== null ? (
            <div className="space-y-2 text-start">
              <Label htmlFor="shift-page-count">{t('countLabel')}</Label>
              <Input
                id="shift-page-count"
                value={closingCount}
                onChange={(event) => setClosingCount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="force-ltr"
                autoFocus
                disabled={isBusy}
              />
              {/* Stated AFTER the field, and only as context — leading with
                  the expected figure invites the count to be typed to match
                  it, which is the one thing a variance exists to detect. */}
              {expectedCash !== null ? (
                <p className="text-muted-foreground text-xs">
                  {t('expectedHint', { float: shift.openingFloat, cash: expectedCash })}
                </p>
              ) : null}
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleFinish()} disabled={isBusy}>
              <LogOut className="size-4" aria-hidden />
              {t('end')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
