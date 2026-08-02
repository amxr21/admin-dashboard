'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Package,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A single headline number — the one tile anatomy every KPI in the strip
 * shares: icon, label, value, delta, optional status. Every slot always
 * renders SOMETHING, even when the underlying data doesn't have a value for
 * it (see the delta slot below) — that's what keeps every tile in the strip
 * the same height without relying on content to accidentally match.
 *
 * The delta carries an icon AND a sign, never colour alone. Red/green is
 * invisible to roughly 1 in 12 men, and this is exactly the "status colour"
 * case the skill reserves: it ships with a shape, or it does not ship.
 */

/**
 * Icons are looked up by NAME, not passed as components.
 *
 * A React component is a function, and functions cannot cross the
 * Server→Client boundary — passing `icon={TrendingUp}` from a Server Component
 * fails the production build with "Functions cannot be passed directly to
 * Client Components". It compiles and runs fine in dev, so it only surfaces at
 * build time.
 *
 * A string key serialises cleanly and keeps the page a Server Component.
 */
const ICONS = {
  revenue: TrendingUp,
  orders: ShoppingCart,
  customers: Users,
  pending: Package,
  inventory: Boxes,
} satisfies Record<string, LucideIcon>;

export type StatIcon = keyof typeof ICONS;

/**
 * The central polarity descriptor: which metrics have "down is good" as
 * their default judgement, keyed by `labelKey`. A caller passing `labelKey`
 * without an explicit `invertDelta` now gets the right colour automatically
 * — a new KPI tile can't silently paint a growing cancellation/pending/
 * low-stock count green just because whoever wired it up forgot the prop.
 * `invertDelta` remains a genuine override for a case this map gets wrong,
 * it just stops being the ONLY thing standing between a metric and a
 * backwards colour.
 */
const INVERTED_METRICS = new Set(['canceledOrders', 'pendingOrders', 'lowStockProducts']);

export interface StatTileProps {
  labelKey: string;
  value: number;
  /** Percentage change vs the comparison period. Omit when the metric has
   *  no meaningful comparison (e.g. a live snapshot) — the delta SLOT still
   *  renders, just with a neutral placeholder instead of a number. */
  deltaPercent?: number;
  /** Names WHICH period the delta compares against; must track the
   *  dashboard's comparison selector. Ignored when `deltaPercent` is omitted. */
  comparisonLabel?: string;
  /** Shown in the delta slot in place of a percentage, when this metric
   *  genuinely has no period-over-period comparison to show (as opposed to
   *  one that just hasn't loaded yet). Defaults to a generic placeholder. */
  noDeltaReason?: string;
  /**
   * For metrics where a rise is BAD (refunds, cancellations). Defaults from
   * the central `INVERTED_METRICS` descriptor by `labelKey` — pass this only
   * to OVERRIDE that default, not to supply it from scratch.
   */
  invertDelta?: boolean;
  format?: 'number' | 'currency';
  /** Looked up in ICONS — a component cannot cross the RSC boundary. */
  icon?: StatIcon;
  /** Optional status slot — e.g. an attention badge when a metric crosses a
   *  threshold. Not consumed by any caller yet; the slot exists so a future
   *  one can fill it without changing the tile's anatomy. */
  status?: ReactNode;
  isLoading?: boolean;
  /** Makes the whole tile a drill-down link — a KPI with nowhere to go is a
   *  dead end. Omit for tiles with no matching destination view. */
  href?: string;
}

export function StatTile({
  labelKey,
  value,
  deltaPercent,
  comparisonLabel,
  noDeltaReason,
  invertDelta,
  format = 'number',
  icon,
  status,
  isLoading = false,
  href,
}: StatTileProps) {
  const Icon = icon ? ICONS[icon] : null;

  const t = useTranslations('dashboard');
  const formatter = useFormatter();

  if (isLoading) {
    // Three lines, matching the loaded tile's three rows (label, value,
    // delta) — a skeleton with fewer rows than the real content resizes the
    // instant data arrives, which reads as a layout jump, not a reveal.
    return (
      <div className="bg-card rounded-lg border p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-32" />
        <Skeleton className="mt-2 h-3.5 w-28" />
      </div>
    );
  }

  const effectiveInvertDelta = invertDelta ?? INVERTED_METRICS.has(labelKey);

  const hasDelta = deltaPercent !== undefined;
  const isRising = hasDelta && deltaPercent > 0;
  // "Good" is not the same as "up". A rise in cancellations is bad.
  const isGood = hasDelta && (effectiveInvertDelta ? deltaPercent < 0 : deltaPercent > 0);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          {Icon ? <Icon className="size-4" aria-hidden /> : null}
          <span>{t(labelKey)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {status}
          {/* The drill-down affordance itself — a bare card gives no hint it
              leads anywhere. Points toward reading-end: two icons swapped by
              `rtl:`, same pattern as the "View reports" link below on this
              page, not a single icon rotated. */}
          {href ? (
            <>
              <ChevronRight className="text-muted-foreground/60 size-4 shrink-0 rtl:hidden" aria-hidden />
              <ChevronLeft className="text-muted-foreground/60 hidden size-4 shrink-0 rtl:block" aria-hidden />
            </>
          ) : null}
        </div>
      </div>

      {/* tabular-nums so the digits don't reflow as values update — a jittering
          number is hard to read and looks broken. */}
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {format === 'currency'
          ? formatter.number(value, 'currency')
          : formatter.number(value)}
      </p>

      {/* The delta slot ALWAYS renders — never omitted — so every tile in
          the strip has the same three rows and therefore the same height,
          whether or not this particular metric has a period-over-period
          comparison to show. A metric with no delta gets a neutral
          placeholder here, explaining why, rather than an empty gap that
          reads as a shorter, ragged card. */}
      {hasDelta ? (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-xs tabular-nums',
            isGood ? 'text-success' : 'text-destructive',
          )}
        >
          {/* The arrow is the non-colour encoding. It reflects DIRECTION
              (up/down), while the colour reflects JUDGEMENT (good/bad) — which
              is why they can legitimately disagree on an inverted metric. */}
          {isRising ? (
            <TrendingUp className="size-3.5" aria-hidden />
          ) : (
            <TrendingDown className="size-3.5" aria-hidden />
          )}
          <span>
            {formatter.number(Math.abs(deltaPercent) / 100, {
              style: 'percent',
              maximumFractionDigits: 1,
            })}
          </span>
          <span className="text-muted-foreground">{comparisonLabel ?? t('vsPreviousPeriod')}</span>
        </p>
      ) : (
        <p className="text-muted-foreground mt-1 text-xs">
          {noDeltaReason ?? t('noComparison')}
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        // The accessible name has to say where this goes, not just repeat
        // the visible label — "Orders" the metric and "Orders" the
        // destination are the same word here, but a screen reader user
        // shouldn't have to guess that a KPI tile is also a link at all.
        aria-label={t('viewDetails', { label: t(labelKey) })}
        className={cn(
          'bg-card block rounded-lg border p-4 transition-colors',
          'hover:border-primary/40 hover:bg-primary/5',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className="bg-card rounded-lg border p-4">{body}</div>;
}
