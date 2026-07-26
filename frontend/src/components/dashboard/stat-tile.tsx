'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  Package,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A single headline number.
 *
 * Per the dataviz form heuristic, a single value's job is a HERO NUMBER, not a
 * chart — a one-bar bar chart or a lone gauge communicates less than the digits
 * do, and costs more space.
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
} satisfies Record<string, LucideIcon>;

export type StatIcon = keyof typeof ICONS;

export interface StatTileProps {
  labelKey: string;
  value: number;
  /** Percentage change vs the previous period. Omit when unknown. */
  deltaPercent?: number;
  /**
   * For metrics where a rise is BAD (refunds, cancellations). Without this the
   * tile would paint a spike in cancellations green.
   */
  invertDelta?: boolean;
  format?: 'number' | 'currency';
  /** Looked up in ICONS — a component cannot cross the RSC boundary. */
  icon?: StatIcon;
  isLoading?: boolean;
}

export function StatTile({
  labelKey,
  value,
  deltaPercent,
  invertDelta = false,
  format = 'number',
  icon,
  isLoading = false,
}: StatTileProps) {
  const Icon = icon ? ICONS[icon] : null;

  const t = useTranslations('dashboard');
  const formatter = useFormatter();

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-32" />
      </div>
    );
  }

  const hasDelta = deltaPercent !== undefined;
  const isRising = hasDelta && deltaPercent > 0;
  // "Good" is not the same as "up". A rise in cancellations is bad.
  const isGood = hasDelta && (invertDelta ? deltaPercent < 0 : deltaPercent > 0);

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
        <span>{t(labelKey)}</span>
      </div>

      {/* tabular-nums so the digits don't reflow as values update — a jittering
          number is hard to read and looks broken. */}
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {format === 'currency'
          ? formatter.number(value, 'currency')
          : formatter.number(value)}
      </p>

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
          <span className="text-muted-foreground">{t('vsPreviousPeriod')}</span>
        </p>
      ) : null}
    </div>
  );
}
