'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, PackagePlus } from 'lucide-react';

import { AttentionPills } from '@/components/dashboard/attention-pills';
import {
  ADVANCED_INSIGHTS_REGION_ID,
  AdvancedInsightsToggle,
} from '@/components/dashboard/advanced-insights-toggle';
import { DashboardModeToggle } from '@/components/dashboard/dashboard-mode-toggle';
import { DayTimelineWidget } from '@/components/dashboard/day-timeline-widget';
import { FloorBand } from '@/components/dashboard/floor-band';
import { FulfillmentHealthWidget } from '@/components/dashboard/fulfillment-health-widget';
import { LatestNotificationsWidget } from '@/components/dashboard/latest-notifications-widget';
import { LatestOrdersWidget } from '@/components/dashboard/latest-orders-widget';
import { LowStockWidget } from '@/components/dashboard/low-stock-widget';
import { OrderValueWidget } from '@/components/dashboard/order-value-widget';
import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { ReturnsSummaryWidget } from '@/components/dashboard/returns-summary-widget';
import { StatTile } from '@/components/dashboard/stat-tile';
import { BranchSummary } from '@/components/dashboard/branch-summary';
import { SimpleDashboard } from '@/components/dashboard/simple-dashboard';
import { StatusBreakdownWidget } from '@/components/dashboard/status-breakdown-widget';
import { TemplateSwitcher } from '@/components/dashboard/template-switcher';
import { TopProductsWidget } from '@/components/dashboard/top-products-widget';
import { Link } from '@/i18n/navigation';
import { RefreshButton } from '@/components/refresh-button';
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
import { useAuth } from '@/hooks/useAuth';
import { useUrlState } from '@/hooks/useUrlState';
import { landingFor } from '@/config/areas';
import { useCanAccessArea } from '@/components/providers/role-permissions-provider';
import { useEffectiveRole } from '@/components/providers/effective-role-provider';
import { useAppSettings } from '@/components/providers/settings-provider';
import { defaultModeFor, readMode, writeMode, type DashboardMode } from '@/lib/dashboard-mode';
import {
  DEFAULT_DASHBOARD_COMPARISON,
  parseDashboardState,
  rangeToDashboardParams,
} from '@/lib/dashboard-state';
import {
  DEFAULT_DASHBOARD_TEMPLATE,
  readTemplate,
  writeTemplate,
  type DashboardTemplate,
} from '@/lib/dashboard-template';
import { fetchOrders, type OrderListRow } from '@/lib/orders-api';
import { fetchRows, type ResourceRow } from '@/lib/resource-api';
import {
  deltaPercent,
  fetchDayTimeline,
  fetchFloorStatus,
  fetchFulfillmentHealth,
  fetchLowStockSnapshot,
  fetchNeedsAttention,
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
  type DayTimeline,
  type FloorStatus,
  type FulfillmentHealth,
  type LowStockSnapshot,
  type NeedsAttention,
  type OrderValueDistribution,
  type Overview,
  type ReturnsSummary,
  type StatusBreakdown,
  type TopProducts,
} from '@/lib/reports-api';

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

/**
 * Simple or Detailed. The choice is remembered per browser; with none stored,
 * a Home Business starts Simple and every other business keeps the Detailed
 * page it already had. Both views read the EFFECTIVE role, so View As shows
 * exactly what that role would see.
 */
export function DashboardOverview() {
  const { user } = useAuth();
  const previewRole = useEffectiveRole();
  const role = previewRole ?? user?.role ?? null;
  const { businessType, isLoading } = useAppSettings();
  const [mode, setMode] = useState<DashboardMode | null>(null);

  // Resolved after settings load, so the business-type default is not decided
  // from the empty placeholder and then flipped a moment later.
  useEffect(() => {
    if (isLoading) return;
    setMode((current) => current ?? readMode() ?? defaultModeFor(businessType));
  }, [isLoading, businessType]);

  if (mode === null) return <Skeleton className="h-40 w-full" />;

  const controls = (
    <DashboardModeToggle
      value={mode}
      onChange={(next) => {
        setMode(next);
        writeMode(next);
      }}
    />
  );

  return mode === 'simple' ? (
    <SimpleDashboard role={role} controls={controls} />
  ) : (
    <DetailedDashboard controls={controls} />
  );
}
function DetailedDashboard({ controls }: { controls: ReactNode }) {
  const canAccessArea = useCanAccessArea();
  const t = useTranslations('dashboard');
  const { user } = useAuth();
  const previewRole = useEffectiveRole();
  const effectiveRole = previewRole ?? user?.role ?? null;
  /**
   * O3.3 — every widget on this page reads a `/reports/*` endpoint, and all of
   * them sit behind `requireArea('reports')`. A FULFILLMENT or SUPPORT user
   * has no such grant, so before this the dashboard did not merely show them
   * the wrong question: every panel 403'd and the page rendered as an error.
   *
   * Gated once rather than per widget, because the dependency is the same for
   * all of them — a per-widget check would be nine copies of one condition.
   */
  const canSeeReports = effectiveRole ? canAccessArea(effectiveRole, 'reports') : false;
  const translateError = useTranslatedApiError();
  const { values, setValues } = useUrlState({
    from: '',
    to: '',
    comparison: DEFAULT_DASHBOARD_COMPARISON,
  });
  // Destructured so the memo depends on the three VALUES rather than the
  // `values` object, which `useUrlState` rebuilds every render — depending on
  // the object would recompute (and hand `load()` a new range identity) on
  // every render, refetching the whole dashboard each time.
  const { from: fromParam, to: toParam, comparison: comparisonParam } = values;
  const dashboardState = useMemo(
    () => parseDashboardState({ from: fromParam, to: toParam, comparison: comparisonParam }),
    [fromParam, toParam, comparisonParam],
  );
  const { range, comparison } = dashboardState;

  /**
   * Which shape the live band takes. Read from `localStorage` in an effect
   * rather than in the initialiser: the server render has no `window`, and
   * seeding state from it directly would hydrate-mismatch the first paint.
   */
  const [template, setTemplate] = useState<DashboardTemplate>(DEFAULT_DASHBOARD_TEMPLATE);
  // The first paint answers the owner's daily questions. Secondary analysis
  // remains available without making every visit begin with a wall of panels.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    setTemplate(readTemplate());
  }, []);

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
  /**
   * The three "what is happening right now" panels. Unlike everything above
   * them these are NOT period-scoped — see each widget's own note. They are
   * still loaded inside the same `load()` so one refresh updates the whole
   * page rather than leaving three panels on an older clock.
   */
  /**
   * The floor band and the attention queues. Neither is period-scoped — both
   * describe "right now" — but both load inside the same `load()` as
   * everything else so one refresh moves the whole page to one clock.
   */
  const [floor, setFloor] = useState<FloorStatus | null>(null);
  const [attention, setAttention] = useState<NeedsAttention | null>(null);
  /** Live catalogue state — `stock <= threshold` right now, not over the range. */
  const [lowStock, setLowStock] = useState<LowStockSnapshot | null>(null);
  /** Range-scoped, unlike the floor band: the same feed answers "last Tuesday". */
  const [timeline, setTimeline] = useState<DayTimeline | null>(null);
  const [latestOrders, setLatestOrders] = useState<OrderListRow[] | null>(null);
  const [latestNotifications, setLatestNotifications] = useState<ResourceRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    // Not a request whose result is discarded — a role without the grant must
    // not fire ten requests that all 403.
    if (!canSeeReports) {
      setIsLoading(false);
      return;
    }

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
        loadedLatestOrders,
        loadedLatestNotifications,
        loadedFloor,
        loadedAttention,
        loadedLowStock,
        loadedTimeline,
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
        fetchOrders({ page: 1, pageSize: 5, sort: 'placedAt', dir: 'desc' }),
        // Branch scoping is applied server-side by the resource engine, so no
        // branch filter is passed here — see `branchScopeField`.
        fetchRows('notifications', { pageSize: 5, sort: 'createdAt', dir: 'desc' }),
        // Live state, like the three panels above — no range params, and
        // branch scoping is applied server-side.
        fetchFloorStatus(),
        fetchNeedsAttention(),
        fetchLowStockSnapshot(),
        fetchDayTimeline(range, 40),
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
      setLatestOrders(loadedLatestOrders.orders);
      setLatestNotifications(loadedLatestNotifications.rows);
      setFloor(loadedFloor);
      setAttention(loadedAttention);
      setLowStock(loadedLowStock);
      setTimeline(loadedTimeline);
      setLastUpdated(new Date());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, comparison, translateError, canSeeReports]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (dashboardState.needsNormalization) {
      setValues({ from: null, to: null, comparison: null });
    }
  }, [dashboardState.needsNormalization, setValues]);

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
    <span className="text-muted-foreground text-xs whitespace-nowrap">
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
            <DateRangePresetField
              range={range}
              onChange={(next) =>
                setValues(rangeToDashboardParams(next), { history: 'push' })
              }
              idPrefix="dashboard"
            />

            <Select
              value={comparison}
              onValueChange={(value) =>
                setValues(
                  { comparison: value as typeof comparison },
                  { history: 'push' },
                )
              }
            >
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
            <RefreshButton
              onRefresh={() => void load()}
              isLoading={isLoading}
              lastUpdated={lastUpdated}
            />
            {controls}
            {/* Sits with the range/comparison controls because it is the same
                kind of thing: it changes what the page shows, not the data. */}
            {canSeeReports ? (
              <TemplateSwitcher
                value={template}
                onChange={(next) => {
                  setTemplate(next);
                  writeTemplate(next);
                }}
              />
            ) : null}
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
        A role without `reports` gets a way into their OWN work instead of a
        wall of widgets that would 403. Login already lands them elsewhere
        (O3.4) — this is for the case where they navigate here anyway, by
        bookmark, by the sidebar's Dashboard link, or by clicking the logo.
      */}
      {!canSeeReports ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-medium">{t('noReportsTitle')}</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {t('noReportsBody')}
          </p>
          {effectiveRole ? (
            <Button asChild className="mt-4">
              <Link href={landingFor(effectiveRole)}>{t('noReportsAction')}</Link>
            </Button>
          ) : null}
        </div>
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
      {/*
        Above the grid, and above the KPI strip, because it answers a
        different question from everything below it: not "how did the
        selected period go" but "what is happening on the floor right now".
        Putting it inside the grid would place it under the range picker's
        implied scope, which does not reach it.
      */}
      {canSeeReports ? (
        <Reveal>
          <FloorBand data={floor} template={template} isLoading={isLoading} />
        </Reveal>
      ) : null}

      {canSeeReports ? (
        <Reveal>
          <AttentionPills data={attention} isLoading={isLoading} />
        </Reveal>
      ) : null}

      {canSeeReports ? (
      <div className="grid grid-cols-12 items-start gap-x-8 gap-y-7">
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

        {/* Directly under the KPI strip: the strip is the aggregate (or the
            active branch), this is every branch beside it, so the two belong
            together. Renders nothing at all for a single-branch business. */}
        <Reveal className="col-span-12">
          <BranchSummary range={range} />
        </Reveal>

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
        {/* Low stock beside fulfilment: both are "what is going wrong in the
            warehouse", and the pairing puts the count tile's deep-link target
            next to the orders it would block. */}
        <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
          <LowStockWidget data={lowStock} isLoading={isLoading} />
        </Reveal>

        {/* The "right now" row, last because it is the only group that does
            not describe the selected period — grouping it with the range
            widgets above would imply the range applies to it too. */}
        <Reveal className="col-span-12 sm:col-span-6">
          <LatestOrdersWidget orders={latestOrders} isLoading={isLoading} />
        </Reveal>
        <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
          <LatestNotificationsWidget rows={latestNotifications} isLoading={isLoading} />
        </Reveal>

        <AdvancedInsightsToggle
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((current) => !current)}
        />

        {advancedOpen ? (
          <section
            id={ADVANCED_INSIGHTS_REGION_ID}
            aria-label={t('advanced.title')}
            className="col-span-12 grid grid-cols-12 items-start gap-x-8 gap-y-7"
          >
            <Reveal className="col-span-12 sm:col-span-6">
              <ReturnsSummaryWidget data={returns} isLoading={isLoading} />
            </Reveal>
            <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
              <TopProductsWidget data={topProducts} isLoading={isLoading} />
            </Reveal>

            <Reveal className="col-span-12 sm:col-span-6">
              <StatusBreakdownWidget data={statusBreakdown} isLoading={isLoading} />
            </Reveal>
            <Reveal className="col-span-12 sm:col-span-6" delay={0.03}>
              <OrderValueWidget data={orderValue} isLoading={isLoading} />
            </Reveal>

            {/* The detailed event record is useful for investigation, not the
                first question on every dashboard visit. It remains one
                disclosure away and still links into orders, shifts, returns,
                and the complete audit trail. */}
            <Reveal className="col-span-12">
              <DayTimelineWidget data={timeline} isLoading={isLoading} />
            </Reveal>
          </section>
        ) : null}

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
      ) : null}
    </div>
  );
}
