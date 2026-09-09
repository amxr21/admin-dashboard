'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, LogIn, LogOut, Printer } from 'lucide-react';

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
import { TillReportView } from '@/components/pos/till-report-view';
import { ShiftClockDial } from '@/components/pos/shift-clock-dial';
import { fetchTillReport, type TillReport } from '@/lib/shifts-api';

/**
 * The interactive clock (owner's note, 2026-09-09).
 *
 * Reuses `useShiftClock` — the topbar indicator (`shift-control.tsx`) and
 * the till's own onboarding gate (`sale-screen.tsx`) share the exact same
 * logic, so a fix here cannot drift from either. The circular dial
 * (`ShiftClockDial`) is a pure display of the same `startedAt`/elapsed facts
 * this screen already had — see that component's own doc comment for why it
 * doesn't let you drag a time, unlike the Sleep-app dial that inspired it.
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
  /** The X/Z report (O9 Tier 4) — held here rather than fetched fresh every
   *  render, since a Z report must show the shift as it was AT CLOSE: the
   *  shift itself becomes `null` the moment `finish()` succeeds (that is
   *  what drives the "not on shift" screen), so the id has to be captured
   *  before that happens or there is nothing left to ask the report for. */
  const [report, setReport] = useState<TillReport | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  /** Distinct from `isBusy` (start/finish) — this is purely the drawer-hint
   *  fetch inside the confirm dialog, so a slow one shows its OWN feedback
   *  rather than looking identical to the button doing nothing (the
   *  confusion that prompted this). */
  const [isLoadingExpectedCash, setIsLoadingExpectedCash] = useState(false);

  async function openEndDialog() {
    setConfirmEnd(true);
    setIsLoadingExpectedCash(true);
    try {
      setExpectedCash(await fetchExpectedCash());
    } finally {
      setIsLoadingExpectedCash(false);
    }
  }

  async function handleFinish() {
    // Captured BEFORE finish() runs — `shift` becomes null the instant it
    // succeeds (see the state comment above), and there would be nothing
    // left to ask the Z report for.
    const closedShiftId = shift?.id ?? null;

    await finish(closingCount);
    setClosingCount('');
    setConfirmEnd(false);

    if (closedShiftId) {
      setIsLoadingReport(true);
      try {
        setReport(await fetchTillReport(closedShiftId));
      } catch {
        // The shift closed regardless — a report that failed to load is a
        // missed convenience, never a reason to look like closing failed.
        setReport(null);
      } finally {
        setIsLoadingReport(false);
      }
    }
  }

  async function showXReport() {
    if (!shift) return;

    setIsLoadingReport(true);
    try {
      setReport(await fetchTillReport(shift.id));
    } catch {
      setReport(null);
    } finally {
      setIsLoadingReport(false);
    }
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

        {/* The Z report — only reachable right here, right after close: the
            shift id that produced it is gone the moment this screen shows
            (see the `report` state's own comment), so there is no "view it
            again later from this page" path by design. A closed shift's
            full history stays readable from the staff activity view. */}
        {report ? (
          <div className="space-y-2 rounded-md border p-3 text-start">
            <TillReportView report={report} />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden />
              {t('printReport')}
            </Button>
          </div>
        ) : null}

        <div className="space-y-1">
          <ShiftClockDial startedAt={null} />
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
          {isBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogIn className="size-4" aria-hidden />
          )}
          {isBusy ? t('starting') : t('start')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-lg border p-8 text-center">
      <div className="space-y-1">
        <div aria-live="polite">
          <ShiftClockDial
            startedAt={shift.startedAt}
            durationLabel={elapsedLabel(shift.startedAt)}
            caption={shift.branch.name}
          />
        </div>
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

      {/* An X report — mid-shift, non-destructive, printable any number of
          times. Same shape the Z report shows after close; only `isFinal`
          differs, and that comes from the SERVER (whether closeTill has
          actually run), never guessed at here. */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => void showXReport()}
        disabled={isLoadingReport}
      >
        <Printer className="size-4" aria-hidden />
        {isLoadingReport ? t('loadingReport') : t('viewXReport')}
      </Button>

      {report && !report.isFinal ? (
        <div className="space-y-2 rounded-md border p-3 text-start">
          <TillReportView report={report} />
          <Button variant="outline" className="w-full" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            {t('printReport')}
          </Button>
        </div>
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
              {isLoadingExpectedCash ? (
                <p className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  {t('loadingExpected')}
                </p>
              ) : expectedCash !== null ? (
                <p className="text-muted-foreground text-xs">
                  {t('expectedHint', { float: shift.openingFloat, cash: expectedCash })}
                </p>
              ) : null}
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleFinish()} disabled={isBusy}>
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <LogOut className="size-4" aria-hidden />
              )}
              {isBusy ? t('ending') : t('end')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
