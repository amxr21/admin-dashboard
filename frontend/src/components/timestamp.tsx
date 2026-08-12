'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Every timestamp in the app, in one component.
 *
 * The spec's rule: a relative label ("2 hours ago") with the absolute value
 * ("Aug 8, 2026, 3:14 PM") on hover — never one alone. Relative-only is
 * ambiguous the moment someone asks "wait, what day was that exactly"; a bare
 * absolute value forces mental math for "is this recent". Fourteen call sites
 * rendered `formatter.dateTime(...)` directly before this, all absolute-only,
 * none with a hover value — this consolidates them onto one contract instead
 * of teaching the rule at each site.
 *
 * The relative label itself is next-intl's own `relativeTime`, which wraps
 * `Intl.RelativeTimeFormat` and picks the unit (seconds/minutes/hours/…)
 * automatically — deliberately NOT reimplemented here, since a hand-rolled
 * "under a minute = seconds, under an hour = minutes, …" ladder would just be
 * a second, driftable copy of logic the platform already gets right per
 * locale (including Arabic's distinct dual/plural forms).
 *
 * ## Why it needs its own `useEffect`
 *
 * "3 minutes ago" becomes wrong the instant a minute passes, and nothing
 * re-renders this component when that happens on its own. A live table full
 * of timestamps that were each correct only at the moment they mounted would
 * drift out of sync with the clock. Recomputing on an interval keeps every
 * instance honest without the PARENT needing to know this component has a
 * clock dependency.
 *
 * ## Why the interval is dynamic rather than fixed
 *
 * Recomputing a decade-old timestamp every 30 seconds is pure waste — its
 * label reads the same whether checked now or an hour from now. The next
 * tick is scheduled at whatever cadence the CURRENT age actually needs, so a
 * table of mixed-age rows isn't all paying the price of its newest one.
 */

interface TimestampProps {
  /** ISO string or Date. Never a raw epoch number — see resource-cell.tsx for
   *  why the boundary types stay explicit here. */
  value: string | Date;
  className?: string;
}

/**
 * How soon THIS AGE needs its label recomputed.
 *
 * Coarser than the unit boundaries "relativeTime" itself uses (which also
 * step through weeks/quarters) — this only needs to be right often enough
 * that a visible label never sits stale for more than about one of its own
 * units, not exactly aligned with the formatter's internal thresholds.
 */
function nextTickMs(ageMs: number): number {
  const abs = Math.abs(ageMs);
  if (abs < 60_000) return 1_000;
  if (abs < 3_600_000) return 60_000;
  if (abs < 86_400_000) return 3_600_000;
  return 86_400_000;
}

export function Timestamp({ value, className }: TimestampProps) {
  const t = useTranslations('table');
  const formatter = useFormatter();
  const date = value instanceof Date ? value : new Date(value);
  const dateMs = date.getTime();

  // `now` is state, not read inline, so the relative label re-renders on its
  // own schedule instead of only when something else re-renders this row.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), nextTickMs(dateMs - now));
    return () => clearTimeout(timer);
    // Re-armed on every tick (via `now`) and whenever the underlying instant
    // changes, so a row whose data was replaced doesn't keep ticking against
    // a stale value.
  }, [now, dateMs]);

  if (Number.isNaN(dateMs)) {
    // Malformed input renders as an explicit dash rather than "Invalid Date"
    // — the latter is a JS implementation detail leaking into the UI.
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  const relative = formatter.relativeTime(date, now);
  const absolute = formatter.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* `force-ltr` is deliberately ABSENT: relative phrases ("منذ يوم")
            are prose, not a code, and must reorder normally in Arabic. Only
            the absolute value in the tooltip needs directional protection —
            see the numerals note on i18n/formats.ts. */}
        <time dateTime={date.toISOString()} className={cn('tabular-nums', className)}>
          {relative}
        </time>
      </TooltipTrigger>
      <TooltipContent>
        <span className="force-ltr tabular-nums">{absolute}</span>
        <span className="text-muted-foreground ms-1">{t('utc')}</span>
      </TooltipContent>
    </Tooltip>
  );
}
