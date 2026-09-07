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
import { endShift, fetchMyShift, startShift, type Shift } from '@/lib/shifts-api';

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
    if (!shift || shift.endedAt !== null) return;

    // Once a minute — the label has minute resolution, so a faster tick would
    // re-render for nothing.
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [shift]);

  async function start() {
    setIsBusy(true);

    try {
      const started = await startShift();
      setShift(started);
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
      await endShift(shift.id);
      setShift(null);
      toast.success(t('ended'));
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

  if (shift === null) {
    return (
      <Button variant="ghost" size="sm" onClick={() => void start()} disabled={isBusy}>
        <LogIn className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t('start')}</span>
      </Button>
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
