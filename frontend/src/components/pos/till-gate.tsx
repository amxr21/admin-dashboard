'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useShiftClock } from '@/hooks/useShiftClock';
import { SaleScreen } from '@/components/pos/sale-screen';

/**
 * A deliberate step before the till, not an instant render (owner's note,
 * 2026-09-09: "I need it to show smth like onboarding screen not an
 * instant one"). Opening the till while off shift now asks "ready to start
 * your shift at [Branch]?" instead of dropping straight into a scan field —
 * ties the till directly to a shift being open, so a sale is never rung up
 * with nobody clocked in against it.
 *
 * Reuses `useShiftClock` — the exact same start flow the dedicated Shift
 * page (`/admin/pos/shift`) offers, so starting from here or from there
 * cannot behave differently.
 *
 * ─── WHY THIS DOES NOT BLOCK AN OWNER RINGING UP A SALE WITHOUT A SHIFT ──
 * `sale-screen.tsx`'s own note already covers this: an owner selling outside
 * any shift is real, and the payment simply has no shift attached. This gate
 * is a CONVENIENCE that nudges the common case (a cashier arriving for
 * work), not a hard requirement enforced server-side — checkout still works
 * with no open shift, exactly as it always has.
 */
export function TillGate() {
  const t = useTranslations('pos.gate');
  const { shift, isReady, isBusy, start } = useShiftClock();
  const [openingFloat, setOpeningFloat] = useState('');
  /** Skipping is remembered only for this page visit, not persisted — the
   *  gate should ask again next time the till is opened, not be dismissed
   *  once and forgotten. */
  const [skipped, setSkipped] = useState(false);

  if (!isReady) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-lg border p-8 text-center">
        <Skeleton className="mx-auto h-8 w-48" />
        <Skeleton className="mx-auto h-10 w-full" />
      </div>
    );
  }

  if (shift === null && !skipped) {
    return (
      <div className="mx-auto max-w-md space-y-6 rounded-lg border p-8 text-center">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>

        <div className="space-y-2 text-start">
          <Label htmlFor="till-gate-float">{t('openingFloat')}</Label>
          {/* Optional on purpose: most shifts have no till, and forcing a 0
              would make "no drawer" indistinguishable from "an empty one". */}
          <Input
            id="till-gate-float"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
            placeholder={t('floatPlaceholder')}
            inputMode="decimal"
            className="force-ltr"
            disabled={isBusy}
          />
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={() => void start(openingFloat)}
          disabled={isBusy}
        >
          <LogIn className="size-4" aria-hidden />
          {t('startAndOpen')}
        </Button>

        {/* An owner ringing up a sale outside any shift is real (see the
            note above) — this must stay reachable, not force a shift on
            someone who does not want one. */}
        <Button variant="ghost" size="sm" onClick={() => setSkipped(true)} disabled={isBusy}>
          {t('skip')}
        </Button>
      </div>
    );
  }

  return <SaleScreen />;
}
