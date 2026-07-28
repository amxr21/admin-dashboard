'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { StatTile } from '@/components/dashboard/stat-tile';
import { Reveal } from '@/components/motion/reveal';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  defaultRange,
  fetchOverview,
  fetchRevenue,
  type Overview,
} from '@/lib/reports-api';

/**
 * The dashboard, on REAL data.
 *
 * ─── WHAT THIS REPLACED ──────────────────────────────────────────────
 * This page used to render `sampleRevenue()` — a sine wave. The source said so
 * plainly, but the RENDERED PAGE did not: anyone demoing the dashboard was
 * showing invented revenue as though it were real, and the only way to know
 * was to read the file.
 *
 * Sample data with a visible label is a reasonable placeholder. Sample data
 * that looks identical to the real thing is a trap, and it gets more dangerous
 * the more finished the rest of the app looks.
 *
 * ─── A CLIENT COMPONENT, LIKE EVERY OTHER FETCH HERE ─────────────────
 * The token lives in the auth provider, so the request has to happen in the
 * browser. The page around this stays a Server Component so the shell is still
 * statically rendered.
 */

export function DashboardOverview() {
  const t = useTranslations('dashboard');
  const translateError = useTranslatedApiError();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [points, setPoints] = useState<RevenuePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const range = defaultRange();

    // Both in parallel: the tiles and the chart describe the same window, so
    // there is no reason to make the user wait for them in sequence.
    Promise.all([fetchOverview(range), fetchRevenue(range, 'day')])
      .then(([loadedOverview, series]) => {
        if (cancelled) return;

        setOverview(loadedOverview);
        setPoints(
          series.points.map((point) => ({
            date: point.date,
            // The chart needs a number for a pixel height. This is the one
            // permitted parse — it is display-only and never written back.
            revenue: Number(point.revenue),
          })),
        );
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [translateError]);

  return (
    <div className="space-y-6">
      <Reveal>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('title')}>
          {isLoading || !overview ? (
            // Four skeletons, matching the four tiles — a different count would
            // make the layout jump when the real data lands.
            Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))
          ) : (
            <>
              <StatTile
                labelKey="totalRevenue"
                value={Number(overview.revenue)}
                format="currency"
                icon="revenue"
              />
              <StatTile labelKey="totalOrders" value={overview.orders} icon="orders" />
              <StatTile
                labelKey="canceledOrders"
                value={overview.canceledOrders}
                icon="pending"
                // A rise in cancellations is BAD — without this the tile would
                // paint a spike in them green.
                invertDelta
              />
              <StatTile
                labelKey="lowStockProducts"
                value={overview.lowStockProducts}
                icon="inventory"
                invertDelta
              />
            </>
          )}
        </section>
      </Reveal>

      <Reveal>
        <RevenueChart data={points} isLoading={isLoading} error={error} />
      </Reveal>
    </div>
  );
}
