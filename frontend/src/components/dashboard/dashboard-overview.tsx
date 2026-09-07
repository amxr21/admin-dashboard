'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, PackagePlus, RefreshCw } from 'lucide-react';

import { FulfillmentHealthWidget } from '@/components/dashboard/fulfillment-health-widget';
import { OrderValueWidget } from '@/components/dashboard/order-value-widget';
import { RecentActivityWidget } from '@/components/dashboard/recent-activity-widget';
import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { ReturnsSummaryWidget } from '@/components/dashboard/returns-summary-widget';
import { StatTile } from '@/components/dashboard/stat-tile';
import { StatusBreakdownWidget } from '@/components/dashboard/status-breakdown-widget';
import { TopProductsWidget } from '@/components/dashboard/top-products-widget';
import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { DateRangePresetField } from '@/components/reports/date-range-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchAudit, type AuditEntry } from '@/lib/audit-api';
import {
  defaultRange,
  deltaPercent,
  fetchFulfillmentHealth,
  fetchOrderValueDistribution,
  fetchOverview,
  fetchReturnsSummary,
  fetchRevenue,
  fetchStatusBreakdown,
  fetchTopProducts,
  fillProfitGaps,
  fillRevenueGaps,
  profitCoverageOf,
  previousPeriod,
  samePeriodLastYear,
  type DateRange,
  type FulfillmentHealth,
  type OrderValueDistribution,
  type Overview,
  type ReturnsSummary,
  type StatusBreakdown,
  type TopProducts,
} from '@/lib/reports-api';

type Comparison = 'previous' | 'sameLastYear' | 'none';

/**
 * The dashboard, on REAL data — now with a user-controlled range instead of a
 * fixed 30-day window, real period-over-period comparisons, and four widgets
 * that were previously either missing entirely (recent activity, quick
 * actions) or real backend capabilities with no dashboard surface
 * (fulfillment health, returns summary, order-value distribution — see
 * `reports.service.ts`).
 *
 * ─── REVENUE IS A KPI TILE, NOT A SOLO HERO CARD ──────────────────────
 * It used to get its own oversized card next to a width-starved chart
 * (`RevenueHero`, now deleted). Checklist Phase 3 folds it into the same
 * four-tile strip as Orders/Cancelled/Low stock — one tile anatomy, one grid,
 * the chart gets the full-width row it was being denied.
 *
 * ─── EVERY NEW NUMBER HERE IS A LIVE QUERY, NEVER FABRICATED ─────────
 * Same discipline as the original overview replacing a sine wave: nothing on
 * this page is invented, and a metric this schema cannot honestly compute
 * (margin, supplier data, funnel/session analytics) does not appear here
 * with a guessed value — it's simply not built yet. See the roadmap.
 */

export function DashboardOverview() {
  const t = useTranslations('dashboard');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [range, setRange] = useState<DateRange>(defaultRange);
  const [comparison, setComparison] = useState<Comparison>('previous');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [previousOverview, setPreviousOverview] = useState<Overview | null>(null);
  const [points, setPoints] = useState<RevenuePoint[]>([]);
  const [comparisonPoints, setComparisonPoints] = useState<RevenuePoint[] | null>(null);
  /** F1.3 — index-aligned with `points`; null at a bucket with no costed line. */
  const [profitPoints, setProfitPoints] = useState<(number | null)[] | null>(null);
  const [profitCoverage, setProfitCoverage] = useState<{
    costedLines: number;
    totalLines: number;
  } | null>(null);
  const [topProducts, setTopProducts] = useState<TopProducts | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentHealth | null>(null);
  const [returns, setReturns] = useState<ReturnsSummary | null>(null);
  const [orderValue, setOrderValue] = useState<OrderValueDistribution | null>(null);
  const [recentActivity, setRecentActivity] = useState<AuditEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // "None" means genuinely no request, not a fetch whose result gets
      // discarded — a comparison the user turned off shouldn't still cost a
      // round trip.
      const comparisonRange =
        comparison === 'none' ? null : comparison === 'sameLastYear' ? samePeriodLastYear(range) : previousPeriod(range);

      // Every panel describes the same window (or, for fulfillment/activity,
      // "right now") — fetched together so nothing on the page can disagree
      // about when "now" was.
      const [
        loadedOverview,
        loadedPreviousOverview,
        series,
        comparisonSeries,
        loadedTop,
        loadedBreakdown,
        loadedFulfillment,
        loadedReturns,
        loadedOrderValue,
        loadedActivity,
      ] = await Promise.all([
        fetchOverview(range),
        comparisonRange ? fetchOverview(comparisonRange) : Promise.resolve(null),
        fetchRevenue(range, 'day'),
        // Same "don't pay for a request nobody asked for" discipline as the
        // KPI tiles' comparisonRange above — "None" fetches nothing.
        comparisonRange ? fetchRevenue(comparisonRange, 'day') : Promise.resolve(null),
        fetchTopProducts(range, 5),
        fetchStatusBreakdown(range),
        fetchFulfillmentHealth(range),
        fetchReturnsSummary(range),
        fetchOrderValueDistribution(range),
        fetchAudit({ page: 1, pageSize: 6 }),
      ]);

      setOverview(loadedOverview);
      setPreviousOverview(loadedPreviousOverview);
      setPoints(fillRevenueGaps(series.points, range, 'day'));

      /**
       * The profit line is opt-in on the DATA, not on a setting: it appears
       * only where something in the window actually has a recorded cost.
       *
       * An empty line with a "0 of 400 lines" note would be worse than no
       * line at all — it occupies the legend, implies a measure exists, and
       * says nothing. A business that has never entered a cost simply sees
       * the chart it saw before.
       */
      const coverage = profitCoverageOf(series.points);
      setProfitCoverage(coverage.costedLines > 0 ? coverage : null);
      setProfitPoints(
        coverage.costedLines > 0 ? fillProfitGaps(series.points, range, 'day') : null,
      );
      setComparisonPoints(
        comparisonRange && comparisonSeries
          ? fillRevenueGaps(comparisonSeries.points, comparisonRange, 'day')
          : null,
      );
      setTopProducts(loadedTop);
      setStatusBreakdown(loadedBreakdown);
      setFulfillment(loadedFulfillment);
      setReturns(loadedReturns);
      setOrderValue(loadedOrderValue);
      setRecentActivity(loadedActivity.entries);
      setLastUpdated(new Date());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, comparison, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  // `previousOverview` is already null whenever comparison === 'none' (see
  // `load()`), so these fall through to `undefined` — no deltas rendered —
  // without needing to check `comparison` again here.
  const revenueDelta =
    overview && previousOverview
      ? deltaPercent(Number(overview.revenue), Number(previousOverview.revenue))
      : undefined;
  const ordersDelta =
    overview && previousOverview
      ? deltaPercent(overview.orders, previousOverview.orders)
      : undefined;
  const canceledDelta =
    overview && previousOverview
      ? deltaPercent(overview.canceledOrders, previousOverview.canceledOrders)
      : undefined;
  const grossProfitDelta =
    overview && previousOverview
      ? deltaPercent(Number(overview.grossProfit), Number(previousOverview.grossProfit))
      : undefined;

  /**
   * The coverage qualifier shared by both profit tiles (F1.2).
   *
   * Profit and margin are computed only over order lines that carry a cost
   * snapshot, so presenting either as a plain figure would overstate what
   * the number knows. This renders in the tile's `status` slot — the slot
   * `stat-tile.tsx` defined for exactly this and had no caller for until now.
   *
   * Renders even at FULL coverage ("all lines"), rather than vanishing: an
   * absent qualifier is indistinguishable from a forgotten one, and "is this
   * number complete?" is precisely the question it exists to answer.
   */
  const costCoverageNote = overview ? (
    <span className="text-muted-foreground/80 text-xs whitespace-nowrap">
      {overview.costCoverage.costedLines === overview.costCoverage.totalLines
        ? t('costCoverageAll')
        : t('costCoverage', {
            costed: overview.costCoverage.costedLines,
            total: overview.costCoverage.totalLines,
          })}
    </span>
  ) : null;

  // Names WHICH period a delta compares against — must track `comparison`,
  // never hardcode "previous period" while potentially showing a
  // year-over-year number (checklist 2.14). Deliberately NOT the same
  // strings the comparison picker itself uses ("Previous period") — this is
  // the trailing text on a delta line ("vs previous period"), a different
  // grammatical position that needs its own "vs "-prefixed copy.
  const comparisonLabel = comparison === 'sameLastYear' ? t('vsSameLastYear') : t('vsPreviousPeriod');

  // A noun phrase ("Previous period"), not the "vs "-prefixed variant above —
  // this labels a tooltip ROW ("Previous period: $120"), a different
  // grammatical position than a trailing delta caption.
  const comparisonSeriesLabel =
    comparison === 'sameLastYear' ? t('comparison.sameLastYear') : t('comparison.previousPeriod');

  return (
    <div className="space-y-6">
      {/* The ONE control band this page has left — title now lives in the
          top bar (Phase 2). Date range is a single preset trigger (was two
          bare inputs + Reset), a comparison selector drives every delta's
          label, "Updated ⟨date⟩ ⟨time⟩" IS the refresh control (the separate
          button folded into it), and the only real action — Add product —
          is the primary button at the reading-end. The old ghost-button row
          (View low stock / Audit trail / Order history) stays removed: all
          three duplicated the sidebar. */}
      <Reveal>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePresetField range={range} onChange={setRange} idPrefix="dashboard" />

            <Select value={comparison} onValueChange={(value) => setComparison(value as Comparison)}>
              <SelectTrigger aria-label={t('comparison.label')} className="h-8 w-auto gap-1.5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="previous">{t('comparison.previousPeriod')}</SelectItem>
                <SelectItem value="sameLastYear">{t('comparison.sameLastYear')}</SelectItem>
                <SelectItem value="none">{t('comparison.none')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={isLoading}
              className="text-muted-foreground gap-1.5"
            >
              <RefreshCw className={isLoading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
              {lastUpdated
                ? t('lastUpdated', {
                    date: formatter.dateTime(lastUpdated, { dateStyle: 'medium' }),
                    time: formatter.dateTime(lastUpdated, { timeStyle: 'short' }),
                  })
                : t('refresh')}
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/r/products">
                <PackagePlus className="size-4" aria-hidden />
                {t('quickActions.addProduct')}
              </Link>
            </Button>
          </div>
        </div>
      </Reveal>

      {error ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {/*
       * ONE 12-column grid for the rest of the page (checklist Phase 3) —
       * every section below is a direct child of THIS grid, spanning a
       * whole number of its columns, rather than each section inventing its
       * own separate grid. `items-stretch` (the CSS Grid default, stated
       * explicitly) plus every KPI tile sharing one anatomy is what keeps
       * the strip's row height even instead of ragged.
       *
       * `col-span-12` never changes per breakpoint — it means "full width"
       * at any column count. Tiles go 12 → 6 → 4 (1-up → 2-up → 3-up) as the
       * breakpoint grows; widget pairs go 12 → 6 (1-up → 2-up) and stay
       * there. Driven entirely by Tailwind's breakpoint scale, no inline
       * pixel widths.
       *
       * 3-up, not the previous 4-up: adding gross profit (F1.2) makes SIX
       * tiles, and six across a 12-column grid divides evenly only at 2-up
       * or 3-up. At 4-up the last row would be a two-tile orphan. Three
       * columns keeps both rows full at every breakpoint.
       */}
      <div className="grid grid-cols-12 items-stretch gap-4">
        {/* `contents`: a semantic landmark for the KPI strip that does NOT
            generate its own box — its children become direct items of the
            outer 12-col grid instead of a second, nested one. Keeps this
            page at truly ONE grid, not "one grid plus a nested grid that
            happens to share its column count." */}
        <section className="contents" aria-label={t('title')}>
          {isLoading || !overview ? (
            Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="col-span-12 h-28 w-full sm:col-span-6 lg:col-span-4" />
            ))
          ) : (
            <>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-4">
                <StatTile
                  labelKey="totalRevenue"
                  definition={t('definitions.totalRevenue')}
                  value={Number(overview.revenue)}
                  format="currency"
                  deltaPercent={revenueDelta}
                  comparisonLabel={comparisonLabel}
                  icon="revenue"
                />
              </Reveal>
              {/* Gross profit + margin (F1.2). Both are computed ONLY over
                  order lines carrying a cost snapshot, so both carry the
                  same coverage qualifier — a margin over a third of the
                  lines is not the store's margin, and a bare percentage
                  here would be the most prominent wrong number in the app.
                  `costCoverage` drives that note; when every line is costed
                  it says so instead of disappearing, so the reader never
                  has to wonder whether the qualifier is missing or just
                  not applicable. */}
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.03}>
                <StatTile
                  labelKey="grossProfit"
                  definition={t('definitions.grossProfit')}
                  value={Number(overview.grossProfit)}
                  format="currency"
                  deltaPercent={grossProfitDelta}
                  comparisonLabel={comparisonLabel}
                  icon="profit"
                  status={costCoverageNote}
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.06}>
                {/* No delta: a margin PERCENTAGE that itself moves is best
                    read as a level, and a percent-change-of-a-percent is
                    the classic misread (3 points is not "up 10%"). The
                    delta slot still renders, per the tile anatomy. */}
                <StatTile
                  labelKey="grossMarginPercent"
                  definition={t('definitions.grossMarginPercent')}
                  // Null stays null — the tile renders a dash, never a
                  // fabricated 0% for a margin that cannot be computed.
                  value={overview.grossMarginPercent === null ? null : overview.grossMarginPercent * 100}
                  icon="profit"
                  noDeltaReason={
                    overview.grossMarginPercent === null
                      ? t('noCostRecorded')
                      : t('marginLevelNote')
                  }
                  status={costCoverageNote}
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.09}>
                <StatTile
                  labelKey="totalOrders"
                  definition={t('definitions.totalOrders')}
                  value={overview.orders}
                  deltaPercent={ordersDelta}
                  comparisonLabel={comparisonLabel}
                  icon="orders"
                  href="/admin/orders"
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.12}>
                <StatTile
                  labelKey="canceledOrders"
                  definition={t('definitions.canceledOrders')}
                  value={overview.canceledOrders}
                  deltaPercent={canceledDelta}
                  comparisonLabel={comparisonLabel}
                  icon="pending"
                  // A rise in cancellations is BAD — the central
                  // INVERTED_METRICS descriptor in stat-tile.tsx already
                  // knows this by `labelKey`, no explicit `invertDelta` needed.
                  href="/admin/orders?status=CANCELED"
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-4" delay={0.15}>
                {/* No deltaPercent here on purpose: low-stock is a live
                    snapshot (`stock <= threshold` right now), not scoped to
                    the selected date range on the backend — a period-over-
                    period comparison would just repeat the same number and
                    imply a trend that isn't real. The delta SLOT still
                    renders (noDeltaReason), consistent with the other three
                    tiles. */}
                <StatTile
                  labelKey="lowStockProducts"
                  definition={t('definitions.lowStockProducts')}
                  value={overview.lowStockProducts}
                  icon="inventory"
                  noDeltaReason={t('liveSnapshot')}
                  href="/admin/inventory?lowStock=true"
                />
              </Reveal>
            </>
          )}
        </section>

        <Reveal className="col-span-12">
          <RevenueChart
            data={points}
            granularity="day"
            comparisonData={comparisonPoints}
            comparisonLabel={comparisonSeriesLabel}
            profitData={profitPoints}
            profitCoverage={profitCoverage}
            isLoading={isLoading}
            error={error}
          />
        </Reveal>

        <Reveal className="col-span-12 sm:col-span-6">
          <FulfillmentHealthWidget data={fulfillment} isLoading={isLoading} />
        </Reveal>
        <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
          <ReturnsSummaryWidget data={returns} isLoading={isLoading} />
        </Reveal>

        <Reveal className="col-span-12 sm:col-span-6">
          <TopProductsWidget data={topProducts} isLoading={isLoading} />
        </Reveal>
        <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
          <StatusBreakdownWidget data={statusBreakdown} isLoading={isLoading} />
        </Reveal>

        <Reveal className="col-span-12 sm:col-span-6">
          <OrderValueWidget data={orderValue} isLoading={isLoading} />
        </Reveal>
        <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
          <RecentActivityWidget entries={recentActivity} isLoading={isLoading} />
        </Reveal>

        <Reveal className="col-span-12">
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
        </Reveal>
      </div>
    </div>
  );
}
