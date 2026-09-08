'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  closeTill,
  endShift,
  fetchMyShift,
  fetchShiftTakings,
  startShift,
  type Shift,
} from '@/lib/shifts-api';

/**
 * The clock-on/clock-off logic (F6.3), shared by the topbar's small
 * indicator and the full Shift page (owner's note, 2026-09-09: "shift can be
 * set in a separate tab for cashiers, smth like an interactive clock").
 *
 * Extracted here rather than duplicated, so the two surfaces cannot drift —
 * a fix to the till-close variance math, say, would otherwise need finding
 * and applying twice.
 *
 * ─── THE OPEN SHIFT LIVES ON THE SERVER, NEVER IN localStorage ───────
 * It has to survive a reload and be the same in a second tab, and it is a
 * record other people read — "who is on now" is a question a manager asks of
 * the server, not of one browser.
 *
 * ─── ELAPSED TIME IS DERIVED, NOT COUNTED ────────────────────────────
 * Recomputed from `startedAt` on every tick rather than incremented, so a
 * backgrounded tab (where timers are throttled) shows the true elapsed time
 * the moment it is looked at instead of however far behind it drifted.
 */

export function elapsedLabel(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  // A clock skew or an edited start in the future would render as a negative
  // duration; clamp rather than show "-1h".
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);

  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

export function useShiftClock() {
  const t = useTranslations('shifts');
  const translateError = useTranslatedApiError();

  const [shift, setShift] = useState<Shift | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [variance, setVariance] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setShift(await fetchMyShift());
    } catch {
      // A failure here leaves the clock absent rather than showing an error
      // — not knowing whether you are on shift is not worth interrupting
      // whatever the surface hosting this hook is doing.
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

    // Once a minute — every consumer's label has minute resolution, so a
    // faster tick would re-render for nothing.
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [shift]);

  async function start(openingFloat: string) {
    setIsBusy(true);

    try {
      const started = await startShift(
        openingFloat.trim() === '' ? {} : { openingFloat: openingFloat.trim() },
      );
      setShift(started);
      toast.success(t('started'));
      return started;
    } catch (caught) {
      toast.error(translateError(caught));
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  /** `closingCount` is only read when the shift actually opened a drawer —
   *  passing one for a drawer-less shift would silently be ignored, which
   *  matches the reasoning `shift-control.tsx` documented for that branch. */
  async function finish(closingCount: string) {
    if (!shift) return;

    setIsBusy(true);

    try {
      if (shift.openingFloat !== null) {
        const result = await closeTill(shift.id, closingCount.trim() || '0');
        setVariance(result.variance);
        toast.success(t('tillClosed', { variance: result.variance }));
      } else {
        await endShift(shift.id);
        toast.success(t('ended'));
      }

      setShift(null);
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function fetchExpectedCash(): Promise<string | null> {
    if (!shift || shift.openingFloat === null) return null;

    try {
      const takings = await fetchShiftTakings(shift.id);
      return takings.cash;
    } catch {
      return null;
    }
  }

  return {
    shift,
    isReady,
    isBusy,
    variance,
    dismissVariance: () => setVariance(null),
    start,
    finish,
    fetchExpectedCash,
    /** Included in the dependency surface only so a consumer can force a
     *  re-render off the minute tick without reaching into internals. */
    tick,
  };
}
