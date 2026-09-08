'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  closeTill,
  endShift,
  fetchMyShift,
  fetchShiftTakings,
  startShift,
  type Shift,
} from '@/lib/shifts-api';

/**
 * Clock on and off, from anywhere (F6.3).
 *
 * ─── THE OPEN SHIFT LIVES ON THE SERVER, NEVER IN localStorage ───────
 * It has to survive a reload and be the same in a second tab, and it is a
 * record other people read — "who is on now" is a question a manager asks of
 * the server, not of one browser. Storing it locally would let two tabs
 * disagree, and a cleared cache would lose a shift somebody actually worked.
 *
 * ─── ELAPSED TIME IS DERIVED, NOT COUNTED ────────────────────────────
 * The tick recomputes from `startedAt` rather than incrementing a counter, so
 * a backgrounded tab (where timers are throttled) shows the true elapsed time
 * the moment it is looked at instead of however far behind it drifted.
 */

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  // A clock skew or an edited start in the future would render as a negative
  // duration; clamp rather than show "-1h".
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);

  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

export function ShiftControl() {
  const t = useTranslations('shifts');
  const translateError = useTranslatedApiError();

  const [shift, setShift] = useState<Shift | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [, setTick] = useState(0);

  /**
   * The till (O5.11).
   *
   * `openingFloat` decides which shape the dialog takes: a shift opened with
   * a drawer must be CLOSED with a count, and one opened without never asks
   * for one. Most shifts have no till — a picker never opens a drawer — so
   * asking everybody to count nothing would be friction for the majority.
   */
  const [openingFloat, setOpeningFloat] = useState('');
  const [closingCount, setClosingCount] = useState('');
  const [expectedCash, setExpectedCash] = useState<string | null>(null);
  const [variance, setVariance] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setShift(await fetchMyShift());
    } catch {
      // A failure here leaves the control absent rather than showing an error
      // in the topbar: not knowing whether you are on shift is not worth
      // interrupting whatever you came to the page to do.
      setShift(null);
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // What the drawer SHOULD hold, fetched when the close dialog opens so the
    // cashier can be told the target after counting rather than before —
    // showing it first invites the count to be typed to match.
    if (!confirmEnd || !shift || shift.openingFloat === null) return;

    void fetchShiftTakings(shift.id)
      .then((takings) => setExpectedCash(takings.cash))
      .catch(() => setExpectedCash(null));
  }, [confirmEnd, shift]);

  useEffect(() => {
    if (!shift || shift.endedAt !== null) return;

    // Once a minute — the label has minute resolution, so a faster tick would
    // re-render for nothing.
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [shift]);

  async function start() {
    setIsBusy(true);

    try {
      const started = await startShift(
        openingFloat.trim() === '' ? {} : { openingFloat: openingFloat.trim() },
      );
      setShift(started);
      setOpeningFloat('');
      toast.success(t('started'));
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function finish() {
    if (!shift) return;

    setIsBusy(true);

    try {
      if (shift.openingFloat !== null) {
        // A shift opened with a drawer is closed by COUNTING it. Ending it
        // without a count leaves a till nobody reconciled, which is a state
        // somebody has to chase later.
        const result = await closeTill(shift.id, closingCount.trim() || '0');
        setVariance(result.variance);
        toast.success(t('tillClosed', { variance: result.variance }));
      } else {
        await endShift(shift.id);
        toast.success(t('ended'));
      }

      setShift(null);
      setClosingCount('');
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsBusy(false);
      setConfirmEnd(false);
    }
  }

  // Nothing until the first read settles: flashing "Start shift" at somebody
  // who is already on shift would invite them to click it and get a 409.
  if (!isReady) return null;

  // A variance survives the shift ending, so the cashier sees the result of
  // the count they just made rather than it vanishing with the dialog.
  if (shift === null && variance !== null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setVariance(null)}
        aria-label={t('dismissVariance')}
      >
        <Clock className="size-4" aria-hidden />
        <span className="tabular-nums">{t('varianceShort', { variance })}</span>
      </Button>
    );
  }

  if (shift === null) {
    return (
      <div className="flex items-center gap-1">
        {/* Optional on purpose: most shifts have no till, and forcing a
            0 would make "no drawer" indistinguishable from "an empty one". */}
        <Input
          value={openingFloat}
          onChange={(event) => setOpeningFloat(event.target.value)}
          placeholder={t('floatPlaceholder')}
          aria-label={t('openingFloat')}
          inputMode="decimal"
          className="force-ltr h-8 w-24"
          disabled={isBusy}
        />
        <Button variant="ghost" size="sm" onClick={() => void start()} disabled={isBusy}>
          <LogIn className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t('start')}</span>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirmEnd(true)}
        disabled={isBusy}
        // The duration is in the accessible name too — a screen reader would
        // otherwise get "end shift" with none of the context a sighted user
        // reads off the label.
        aria-label={t('endWithElapsed', { elapsed: elapsed(shift.startedAt) })}
      >
        <Clock className="size-4" aria-hidden />
        <span className="tabular-nums">{elapsed(shift.startedAt)}</span>
      </Button>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('endTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('endBody', { elapsed: elapsed(shift.startedAt), branch: shift.branch.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {shift.openingFloat !== null ? (
            <div className="space-y-2">
              <Label htmlFor="till-count">{t('countLabel')}</Label>
              <Input
                id="till-count"
                value={closingCount}
                onChange={(event) => setClosingCount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="force-ltr"
                autoFocus
                disabled={isBusy}
              />
              {/* Stated AFTER the field, and only as context: leading with
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
            <AlertDialogAction onClick={() => void finish()} disabled={isBusy}>
              <LogOut className="size-4" aria-hidden />
              {t('end')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
