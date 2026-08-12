'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Download, Info, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';

import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
// Reused, not reimplemented: these three render the same three endpoints on the
// dashboard already. A second copy here would be two places to fix when the
// shape changes, and they would drift.
import { FulfillmentHealthWidget } from '@/components/dashboard/fulfillment-health-widget';
import { OrderValueWidget } from '@/components/dashboard/order-value-widget';
import { ReturnsSummaryWidget } from '@/components/dashboard/returns-summary-widget';
import { StatusBreakdownWidget } from '@/components/dashboard/status-breakdown-widget';
import { ErrorSection } from '@/components/errors/error-section';
import { DateRangePresetField } from '@/components/reports/date-range-field';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import {
  GRANULARITIES,
  defaultRange,
  deltaPercent,
  downloadReport,
  fetchFulfillmentHealth,
  fetchOrderValueDistribution,
  fetchOverview,
  fetchReturnsSummary,
  fetchRevenue,
  fetchStatusBreakdown,
  fetchTopProducts,
  fillRevenueGaps,
  previousPeriod,
  samePeriodLastYear,
  type DateRange,
  type FulfillmentHealth,
  type Granularity,
  type OrderValueDistribution,
  type Overview,
  type ReportView,
  type ReturnsSummary,
  type StatusBreakdown,
  type TopProducts,
} from '@/lib/reports-api';

type Comparison = 'previous' | 'sameLastYear' | 'none';

/**
 * Reports — revenue, best sellers and order outcomes over a chosen window.
 *
 * ─── EVERY FIGURE IS A SNAPSHOT, NOT A RECOMPUTATION ─────────────────
 * The API reads `order.total` and the line-item price recorded at the time of
 * sale. Editing a price today does not move last quarter's revenue, which is
 * why two runs of the same report agree.
 *
 * ─── THE RANGE IS BOUNDED, AND SAYS SO WHEN REFUSED ──────────────────
 * The server caps the window because an unbounded range is an unbounded scan.
 * A refusal names the limit rather than failing generically, so the fix is
 * obvious.
 */

/**
 * One shape, reused for every section — the only thing that differs is which
 * view it exports. `sectionLabel` only reaches the accessible name: four
 * buttons all reading "Export CSV" are indistinguishable to anyone browsing
 * by button list rather than visual layout.
 */
function ExportButton({
  label,
  sectionLabel,
  isBusy,
  onExport,
}: {
  label: string;
  sectionLabel: string;
  isBusy: boolean;
  onExport: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onExport}
      disabled={isBusy}
      aria-label={`${label} — ${sectionLabel}`}
    >
      <Download className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

export function ReportsView() {
  const t = useTranslations('reports');
  const tStates = useTranslations('states');
  // The three reused widgets own their titles under `dashboard.*`; the export
  // buttons here borrow the same strings so a button's accessible name always
  // matches the panel it exports.
  const tDashboard = useTranslations('dashboard');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  // C2.6: range/granularity/comparison live in the URL, not local state — a
  // pasted link now reproduces the exact same report, and back/forward steps
  // through the choices actually made, matching the contract `useUrlState`'s
  // own doc comment establishes for the resource tables.
  //
  // `defaults` is memoized with an EMPTY dep array — computed once, not on
  // every render. `defaultRange()` calls `new Date()`, so a fresh object
  // every render would change the underlying VALUE at day rollover and, more
  // immediately, defeats `useUrlState`'s own `JSON.stringify(defaults)`
  // memoization the moment object identity (not content) is what churns.
  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({
    from: defaults.from,
    to: defaults.to,
    granularity: 'day',
    compare: 'previous',
    topLimit: '10',
  });

  // `range` is reconstructed from `values` every render (a new object
  // literal each time) — memoized on its actual CONTENT so `load` below,
  // which depends on it, doesn't get a new identity (and re-fire its
  // effect) every render even when the underlying dates haven't changed.
  const range: DateRange = useMemo(
    () => ({ from: values.from!, to: values.to! }),
    [values.from, values.to],
  );
  const granularity = values.granularity as Granularity;
  const comparison = values.compare as Comparison;
  // Backend caps this at 50 (reports.route.ts) — Number() on a hand-edited
  // URL that ignores the <Select> entirely could still exceed it, so the
  // server's own ceiling is what actually protects the endpoint; this is
  // just keeping the UI's own request sane.
  const topLimit = Number(values.topLimit);

  const setRange = useCallback(
    (next: DateRange) => setValues({ from: next.from, to: next.to }),
    [setValues],
  );
  const setGranularity = useCallback(
    (next: Granularity) => setValues({ granularity: next }),
    [setValues],
  );
  const setComparison = useCallback(
    (next: Comparison) => setValues({ compare: next }),
    [setValues],
  );
  const setTopLimit = useCallback(
    (next: number) => setValues({ topLimit: String(next) }),
    [setValues],
  );

  const [overview, setOverview] = useState<Overview | null>(null);
  const [previousOverview, setPreviousOverview] = useState<Overview | null>(null);
  const [points, setPoints] = useState<RevenuePoint[]>([]);
  const [comparisonPoints, setComparisonPoints] = useState<RevenuePoint[] | null>(null);
  const [top, setTop] = useState<TopProducts | null>(null);
  const [breakdown, setBreakdown] = useState<StatusBreakdown | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentHealth | null>(null);
  const [returns, setReturns] = useState<ReturnsSummary | null>(null);
  const [orderValue, setOrderValue] = useState<OrderValueDistribution | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingView, setExportingView] = useState<ReportView | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const handleExport = useCallback(
    async (view: ReportView, extra?: Record<string, string | number | undefined>) => {
      setExportingView(view);
      setError(null);

      try {
        await downloadReport(view, range, 'csv', extra);
      } catch (caught) {
        // Same mapping the initial load uses — a download failure is almost
        // always the same connectivity/auth story as any other request.
        setError(translateError(caught));
      } finally {
        setExportingView(null);
      }
    },
    [range, translateError],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Same "don't pay for a request nobody asked for" discipline as the
      // dashboard's own comparison fetch — "None" means genuinely no
      // request, not a fetch whose result gets discarded.
      const comparisonRange =
        comparison === 'none' ? null : comparison === 'sameLastYear' ? samePeriodLastYear(range) : previousPeriod(range);

      // One window, questions asked together so every panel describes the
      // same period rather than drifting as each lands.
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
      ] = await Promise.all([
        fetchOverview(range),
        comparisonRange ? fetchOverview(comparisonRange) : Promise.resolve(null),
        fetchRevenue(range, granularity),
        comparisonRange ? fetchRevenue(comparisonRange, granularity) : Promise.resolve(null),
        fetchTopProducts(range, topLimit),
        fetchStatusBreakdown(range),
        fetchFulfillmentHealth(range),
        fetchReturnsSummary(range),
        fetchOrderValueDistribution(range),
      ]);

      setOverview(loadedOverview);
      setPreviousOverview(loadedPreviousOverview);
      setPoints(fillRevenueGaps(series.points, range, granularity));
      setComparisonPoints(
        comparisonRange && comparisonSeries
          ? fillRevenueGaps(comparisonSeries.points, comparisonRange, granularity)
          : null,
      );
      setTop(loadedTop);
      setBreakdown(loadedBreakdown);
      setFulfillment(loadedFulfillment);
      setReturns(loadedReturns);
      setOrderValue(loadedOrderValue);
      setLastUpdated(new Date());
    } catch (caught) {
      // A 400 here is a REASON — "choose a range of 731 days or fewer" — and
      // it names the limit. Flattening it would hide the fix.
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
      // Every panel is cleared, not just the summary: leaving the others
      // populated would show figures for the PREVIOUS range next to an error
      // about the current one, which reads as if they still applied.
      setOverview(null);
      setPreviousOverview(null);
      setFulfillment(null);
      setReturns(null);
      setOrderValue(null);
    } finally {
      setIsLoading(false);
    }
  }, [range, granularity, comparison, topLimit, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Matches the dashboard's own trailing-copy convention exactly — a
  // different grammatical position ("vs previous period") from the picker's
  // own noun-phrase label ("Previous period"), see dashboard-overview.tsx.
  const comparisonLabel =
    comparison === 'sameLastYear' ? tDashboard('vsSameLastYear') : tDashboard('vsPreviousPeriod');
  const comparisonSeriesLabel =
    comparison === 'sameLastYear'
      ? tDashboard('comparison.sameLastYear')
      : tDashboard('comparison.previousPeriod');

  const revenueDelta =
    overview && previousOverview
      ? deltaPercent(Number(overview.revenue), Number(previousOverview.revenue))
      : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePresetField range={range} onChange={setRange} idPrefix="reports" />

          <div className="w-40 space-y-2">
            <Label htmlFor="reports-granularity">{t('granularity')}</Label>
            <Select
              value={granularity}
              onValueChange={(value) => setGranularity(value as Granularity)}
            >
              <SelectTrigger id="reports-granularity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRANULARITIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`granularities.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-44 space-y-2">
            <Label htmlFor="reports-comparison">{tDashboard('comparison.label')}</Label>
            <Select value={comparison} onValueChange={(value) => setComparison(value as Comparison)}>
              <SelectTrigger id="reports-comparison">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="previous">{tDashboard('comparison.previousPeriod')}</SelectItem>
                <SelectItem value="sameLastYear">{tDashboard('comparison.sameLastYear')}</SelectItem>
                <SelectItem value="none">{tDashboard('comparison.none')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* "Updated ⟨date⟩ ⟨time⟩" IS the refresh control, same fold as the
            dashboard's own control band — a separate button next to it would
            be a second way to do the same thing. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={isLoading}
          className="text-muted-foreground gap-1.5"
        >
          <RefreshCw className={isLoading ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
          {lastUpdated
            ? tDashboard('lastUpdated', {
                date: formatter.dateTime(lastUpdated, { dateStyle: 'medium' }),
                time: formatter.dateTime(lastUpdated, { timeStyle: 'short' }),
              })
            : tDashboard('refresh')}
        </Button>
      </div>

      {error ? (
        <ErrorSection
          title={tStates('error.title')}
          description={error}
          onRetry={() => void load()}
        />
      ) : null}

      <section className="space-y-3" aria-label={t('summary')}>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t('summary')}</h2>
          <ExportButton
            label={t('exportCsv')}
            sectionLabel={t('summary')}
            isBusy={exportingView === 'overview'}
            onExport={() => void handleExport('overview')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading || !overview
            ? Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))
            : (
                [
                  { key: 'revenue', value: formatCurrency(Number(overview.revenue)) },
                  { key: 'orders', value: formatter.number(overview.orders) },
                  {
                    key: 'averageOrderValue',
                    value: formatCurrency(Number(overview.averageOrderValue)),
                  },
                  { key: 'newCustomers', value: formatter.number(overview.newCustomers) },
                  // Both of these were already fetched and then dropped on the
                  // floor — the endpoint returns six figures and this strip
                  // rendered four.
                  { key: 'canceledOrders', value: formatter.number(overview.canceledOrders) },
                  { key: 'lowStockProducts', value: formatter.number(overview.lowStockProducts) },
                ] as const
              ).map((tile) => (
                <div key={tile.key} className="bg-card rounded-lg border p-4">
                  <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    {t(`tiles.${tile.key}`)}
                    {/* C2.7: `averageOrderValue`'s denominator EXCLUDES
                        canceled orders (a canceled order has no realized
                        value to average in), while the adjacent `orders`
                        tile counts every order INCLUDING canceled ones —
                        two tiles built from the same window that quietly
                        disagree on what "orders" means unless this says so.
                        Labeled rather than "aligned" (made AOV divide by the
                        undivided count instead): that would be the
                        economically wrong number, counting $0-realized
                        orders toward an AVERAGE VALUE. */}
                    {tile.key === 'averageOrderValue' ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
                            aria-label={t('tiles.averageOrderValueDefinitionLabel')}
                          >
                            <Info className="size-3.5" aria-hidden />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('tiles.averageOrderValueDefinition')}</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
                  {/* Only the revenue tile carries a delta — the dashboard's
                      comparison selector now drives this page too (C2.3),
                      and revenue is the one figure worth a period-over-period
                      read at a glance here; the others stay plain counts. */}
                  {tile.key === 'revenue' && comparison !== 'none' ? (
                    revenueDelta !== undefined ? (
                      <p
                        className={cn(
                          'mt-1 flex items-center gap-1 text-xs tabular-nums',
                          revenueDelta > 0 ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {revenueDelta > 0 ? (
                          <TrendingUp className="size-3.5" aria-hidden />
                        ) : (
                          <TrendingDown className="size-3.5" aria-hidden />
                        )}
                        <span>
                          {formatter.number(Math.abs(revenueDelta) / 100, {
                            style: 'percent',
                            maximumFractionDigits: 1,
                          })}
                        </span>
                        <span className="text-muted-foreground">{comparisonLabel}</span>
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">{tDashboard('noComparison')}</p>
                    )
                  ) : null}
                </div>
              ))}
        </div>
      </section>

      <div className="space-y-3">
        <div className="flex justify-end">
          <ExportButton
            label={t('exportCsv')}
            sectionLabel={t('tiles.revenue')}
            isBusy={exportingView === 'revenue'}
            onExport={() => void handleExport('revenue', { granularity })}
          />
        </div>
        <RevenueChart
          data={points}
          granularity={granularity}
          comparisonData={comparisonPoints}
          comparisonLabel={comparisonSeriesLabel}
          isLoading={isLoading}
          error={null}
          drillDownEnabled
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">{t('topProducts')}</h2>
            <div className="flex items-center gap-2">
              <Label htmlFor="reports-top-limit" className="text-muted-foreground text-xs">
                {t('showTop')}
              </Label>
              {/* Backend allows 1–50 (reports.route.ts); this offers the
                  handful of round numbers actually worth choosing between
                  rather than a raw numeric input. */}
              <Select
                value={String(topLimit)}
                onValueChange={(value) => setTopLimit(Number(value))}
              >
                <SelectTrigger id="reports-top-limit" className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 20, 50].map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ExportButton
                label={t('exportCsv')}
                sectionLabel={t('topProducts')}
                isBusy={exportingView === 'top-products'}
                onExport={() => void handleExport('top-products', { limit: topLimit })}
              />
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : top && top.products.length > 0 ? (
            <ol className="space-y-2">
              {top.products.map((product, index) =>
                // A hard-deleted product has no id to link to — its row
                // stays plain text, same as the name fallback below.
                product.productId ? (
                  <li key={product.productId} className="border-b pb-2 last:border-b-0">
                    <Link
                      href={`/admin/r/products?search=${encodeURIComponent(product.name ?? '')}`}
                      className="hover:bg-muted focus-visible:ring-ring -mx-2 flex items-baseline justify-between gap-3 rounded-md px-2 py-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="min-w-0 truncate">
                        {product.name}
                        <span className="text-muted-foreground ms-2 text-sm tabular-nums">
                          ×{formatter.number(product.quantity)}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatCurrency(Number(product.revenue))}
                      </span>
                    </Link>
                  </li>
                ) : (
                  <li
                    key={`deleted-${String(index)}`}
                    className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-b-0"
                  >
                    <span className="min-w-0 truncate">
                      {/* Null when the product was hard-deleted — line items
                          keep a price snapshot but no name, so there is
                          nothing to fall back to and nowhere to link. */}
                      <em className="text-muted-foreground">{t('deletedProduct')}</em>
                      <span className="text-muted-foreground ms-2 text-sm tabular-nums">
                        ×{formatter.number(product.quantity)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatCurrency(Number(product.revenue))}
                    </span>
                  </li>
                ),
              )}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">{t('noSales')}</p>
          )}
        </section>

        {/* Reused from the dashboard, not reimplemented — this used to be a
            second, drifted copy that never rendered `total` (C2.1) or
            linked anywhere (C2.5's status-breakdown half). One component,
            fixed once, fixes it here too. */}
        <div className="space-y-2">
          <div className="flex justify-end">
            <ExportButton
              label={t('exportCsv')}
              sectionLabel={t('statusBreakdown')}
              isBusy={exportingView === 'status-breakdown'}
              onExport={() => void handleExport('status-breakdown')}
            />
          </div>
          <StatusBreakdownWidget data={breakdown} isLoading={isLoading} />
        </div>
      </div>

      {/* The three panels below read endpoints the backend has always served
          (and exported as CSV) but which this page never called — they existed
          only on the dashboard. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex justify-end">
            <ExportButton
              label={t('exportCsv')}
              sectionLabel={tDashboard('fulfillment.title')}
              isBusy={exportingView === 'fulfillment-health'}
              onExport={() => void handleExport('fulfillment-health')}
            />
          </div>
          <FulfillmentHealthWidget data={fulfillment} isLoading={isLoading} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-end">
            <ExportButton
              label={t('exportCsv')}
              sectionLabel={tDashboard('returns.title')}
              isBusy={exportingView === 'returns-summary'}
              onExport={() => void handleExport('returns-summary')}
            />
          </div>
          <ReturnsSummaryWidget data={returns} isLoading={isLoading} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-end">
          <ExportButton
            label={t('exportCsv')}
            sectionLabel={tDashboard('orderValue.title')}
            isBusy={exportingView === 'order-value-distribution'}
            onExport={() => void handleExport('order-value-distribution')}
          />
        </div>
        <OrderValueWidget data={orderValue} isLoading={isLoading} />
      </div>
    </div>
  );
}
