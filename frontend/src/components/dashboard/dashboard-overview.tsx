'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { RevenueHero } from '@/components/dashboard/revenue-hero';
import { StatTile } from '@/components/dashboard/stat-tile';
import { StatusBreakdownWidget } from '@/components/dashboard/status-breakdown-widget';
import { TopProductsWidget } from '@/components/dashboard/top-products-widget';
import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/motion/reveal';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  defaultRange,
  fetchOverview,
  fetchRevenue,
  fetchStatusBreakdown,
  fetchTopProducts,
  type Overview,
  type StatusBreakdown,
  type TopProducts,
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
 * ─── LAYOUT ───────────────────────────────────────────────────────────
 * Revenue is the headline metric, not a fifth of a four-box row: it gets its
 * own hero figure next to the chart, sized and placed so it reads first. The
 * remaining three stats are supporting context underneath, and best sellers /
 * order outcomes give the page something to look at beyond one number and one
 * line — both already existed on Reports, just never surfaced here.
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
  const [topProducts, setTopProducts] = useState<TopProducts | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const range = defaultRange();

    // All in parallel: every panel on this page describes the same window, so
    // there is no reason to make the user wait for them in sequence.
    Promise.all([
      fetchOverview(range),
      fetchRevenue(range, 'day'),
      fetchTopProducts(range, 5),
      fetchStatusBreakdown(range),
    ])
      .then(([loadedOverview, series, loadedTop, loadedBreakdown]) => {
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
        setTopProducts(loadedTop);
        setStatusBreakdown(loadedBreakdown);
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
        <div className="grid gap-4 lg:grid-cols-3">
          <RevenueHero
            value={overview ? Number(overview.revenue) : 0}
            isLoading={isLoading || !overview}
          />
          <div className="lg:col-span-2">
            <RevenueChart data={points} isLoading={isLoading} error={error} />
          </div>
        </div>
      </Reveal>

      <Reveal>
        <section className="grid gap-4 sm:grid-cols-3" aria-label={t('title')}>
          {isLoading || !overview ? (
            // Three skeletons, matching the three supporting tiles — a
            // different count would make the layout jump when data lands.
            Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))
          ) : (
            <>
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
        <div className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <TopProductsWidget data={topProducts} isLoading={isLoading} />
            <StatusBreakdownWidget data={statusBreakdown} isLoading={isLoading} />
          </div>

          <div className="flex justify-end">
            <Link
              href="/admin/reports"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              {t('viewReports')}
              <ArrowRight className="size-3.5 rtl:hidden" aria-hidden />
              <ArrowLeft className="hidden size-3.5 rtl:block" aria-hidden />
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
