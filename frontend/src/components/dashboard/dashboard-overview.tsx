'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, PackagePlus, RefreshCw, TicketPlus } from 'lucide-react';

import { FulfillmentHealthWidget } from '@/components/dashboard/fulfillment-health-widget';
import { NeedsAttentionWidget } from '@/components/dashboard/needs-attention-widget';
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
  fetchNeedsAttention,
  fetchOrderValueDistribution,
  fetchOverview,
  fetchReturnsSummary,
  fetchRevenue,
  fetchStatusBreakdown,
  fetchTopProducts,
  fillOrdersGaps,
  fillRevenueGaps,
  previousPeriod,
  samePeriodLastYear,
  type DateRange,
  type FulfillmentHealth,
  type NeedsAttention,
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
  // C1.3 — the same already-fetched revenue series carries an `orders` count
  // per bucket; gap-filled the same way for the Orders tile's sparkline, no
  // second request.
  const [ordersPoints, setOrdersPoints] = useState<{ date: string; orders: number | null }[]>([]);
  const [topProducts, setTopProducts] = useState<TopProducts | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentHealth | null>(null);
  const [needsAttention, setNeedsAttention] = useState<NeedsAttention | null>(null);
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
        loadedNeedsAttention,
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
        // No range argument — deliberately live state, see the widget's own
        // doc comment.
        fetchNeedsAttention(),
        fetchReturnsSummary(range),
        fetchOrderValueDistribution(range),
        fetchAudit({ page: 1, pageSize: 6 }),
      ]);

      setOverview(loadedOverview);
      setPreviousOverview(loadedPreviousOverview);
      setPoints(fillRevenueGaps(series.points, range, 'day'));
      setOrdersPoints(fillOrdersGaps(series.points, range, 'day'));
      setComparisonPoints(
        comparisonRange && comparisonSeries
          ? fillRevenueGaps(comparisonSeries.points, comparisonRange, 'day')
          : null,
      );
      setTopProducts(loadedTop);
      setStatusBreakdown(loadedBreakdown);
      setFulfillment(loadedFulfillment);
      setNeedsAttention(loadedNeedsAttention);
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
  const unitsSoldDelta =
    overview && previousOverview
      ? deltaPercent(overview.unitsSold, previousOverview.unitsSold)
      : undefined;

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
          button folded into it). The old ghost-button row (View low stock /
          Audit trail / Order history) stays removed: all three duplicated
          the sidebar.
          Quick actions are the two that actually exist: Add product
          (primary) and Create discount (secondary). "Create order" is
          deliberately NOT here — there is no order-creation path anywhere in
          this app (no `POST /orders`, no admin form; orders are
          storefront-originated only, see CLAUDE.md). Both link to the
          resource's list page rather than opening its create Sheet directly
          — `resource-table.tsx` owns that Sheet's open state and has no
          URL-addressable way to request it pre-opened. */}
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
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/r/discounts">
                <TicketPlus className="size-4" aria-hidden />
                {t('quickActions.createDiscount')}
              </Link>
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
       * at any column count. Tiles go 12 → 6 → 3 (1-up → 2-up → 4-up) as the
       * breakpoint grows; widget pairs go 12 → 6 (1-up → 2-up) and stay
       * there. Driven entirely by Tailwind's breakpoint scale, no inline
       * pixel widths.
       */}
      <div className="grid grid-cols-12 items-stretch gap-4">
        {/* `contents`: a semantic landmark for the KPI strip that does NOT
            generate its own box — its children become direct items of the
            outer 12-col grid instead of a second, nested one. Keeps this
            page at truly ONE grid, not "one grid plus a nested grid that
            happens to share its column count." */}
        <section className="contents" aria-label={t('title')}>
          {isLoading || !overview ? (
            // C1.2: 6 tiles now, not 4 — the spec's KPI row width, refund
            // rate and fulfilment SLA are the two still missing (need new
            // reports-service aggregates, tracked separately, not silently
            // dropped).
            Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="col-span-12 h-36 w-full sm:col-span-6 lg:col-span-2" />
            ))
          ) : (
            <>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-2">
                <StatTile
                  labelKey="totalRevenue"
                  definitionKey="definitions.totalRevenue"
                  value={Number(overview.revenue)}
                  format="currency"
                  deltaPercent={revenueDelta}
                  comparisonLabel={comparisonLabel}
                  icon="revenue"
                  sparklineData={points.map((point) => ({ date: point.date, value: point.revenue }))}
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-2" delay={0.03}>
                <StatTile
                  labelKey="totalOrders"
                  definitionKey="definitions.totalOrders"
                  value={overview.orders}
                  deltaPercent={ordersDelta}
                  comparisonLabel={comparisonLabel}
                  icon="orders"
                  href="/admin/orders"
                  sparklineData={ordersPoints.map((point) => ({ date: point.date, value: point.orders }))}
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-2" delay={0.06}>
                <StatTile
                  labelKey="averageOrderValue"
                  definitionKey="definitions.averageOrderValue"
                  value={Number(overview.averageOrderValue)}
                  format="currency"
                  icon="average"
                  // Excludes cancelled orders (see the definition tooltip) —
                  // a period-over-period delta for AOV isn't wired here
                  // since neither this file nor `previousOverview` had one
                  // before this session and computing it well needs the
                  // same "0 paid orders → undefined, not NaN" guard the
                  // backend already applies — left for a follow-up rather
                  // than approximated.
                  noDeltaReason={t('noComparison')}
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-2" delay={0.09}>
                <StatTile
                  labelKey="unitsSold"
                  definitionKey="definitions.unitsSold"
                  value={overview.unitsSold}
                  deltaPercent={unitsSoldDelta}
                  comparisonLabel={comparisonLabel}
                  icon="units"
                />
              </Reveal>
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-2" delay={0.12}>
                <StatTile
                  labelKey="canceledOrders"
                  definitionKey="definitions.canceledOrders"
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
              <Reveal className="col-span-12 sm:col-span-6 lg:col-span-2" delay={0.15}>
                {/* No deltaPercent here on purpose: low-stock is a live
                    snapshot (`stock <= threshold` right now), not scoped to
                    the selected date range on the backend — a period-over-
                    period comparison would just repeat the same number and
                    imply a trend that isn't real. The delta SLOT still
                    renders (noDeltaReason), consistent with the other tiles. */}
                <StatTile
                  labelKey="lowStockProducts"
                  definitionKey="definitions.lowStockProducts"
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
            isLoading={isLoading}
            error={error}
            drillDownEnabled
          />
        </Reveal>

        {/* C1.5 — the umbrella "what needs a human today" queue, ahead of
            Fulfillment health (one narrower slice of the same question:
            orders stuck past their SLA). Live state, not scoped to the
            range/comparison controls above — see the widget's own doc
            comment for why. */}
        <Reveal className="col-span-12">
          <NeedsAttentionWidget data={needsAttention} isLoading={isLoading} />
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
              href="/admin/reports/overview"
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
