'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { elapsedLabel, useShiftClock } from '@/hooks/useShiftClock';

/**
 * A small, read-only indicator (F6.3, shrunk 2026-09-09 per the owner's
 * note that shift start/end deserves its own page — see
 * `shift-clock-screen.tsx` and `/admin/pos/shift`).
 *
 * All the actual controls — start, end, opening float, till count — moved
 * to that page. This topbar element exists only so a cashier working
 * elsewhere in the app still sees at a glance whether they are clocked in,
 * without carrying a second copy of the start/end logic that could drift
 * from the full page's.
 *
 * ─── WHY IT LINKS RATHER THAN OPENING ITS OWN DIALOG ─────────────────
 * A topbar dropdown duplicating the full page's float input and till-count
 * dialog is exactly the two-places-to-fix problem the shrink was meant to
 * remove. One click here always lands on the one place those controls live.
 */
export function ShiftControl() {
  const t = useTranslations('shifts');
  const { shift, isReady } = useShiftClock();

  // Nothing until the first read settles — flashing "not on shift" at
  // somebody who is on shift, even briefly, reads as a real state rather
  // than a loading one.
  if (!isReady) return null;

  return (
    <Button variant="ghost" size="sm" asChild>
      <Link
        href="/admin/pos/shift"
        aria-label={
          shift
            ? t('endWithElapsed', { elapsed: elapsedLabel(shift.startedAt) })
            : t('notOnShift')
        }
      >
        <Clock className="size-4" aria-hidden />
        {shift ? (
          <span className="tabular-nums">{elapsedLabel(shift.startedAt)}</span>
        ) : (
          <span className="hidden sm:inline">{t('notOnShiftShort')}</span>
        )}
      </Link>
    </Button>
  );
}
