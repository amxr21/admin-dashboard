'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, PackagePlus, RefreshCw } from 'lucide-react';

import { FulfillmentHealthWidget } from '@/components/dashboard/fulfillment-health-widget';
import { OrderValueWidget } from '@/components/dashboard/order-value-widget';
import { RecentActivityWidget } from '@/components/dashboard/recent-activity-widget';
import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { RevenueHero } from '@/components/dashboard/revenue-hero';
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
 * fixed 30-day window, real period-over-period comparisons (the `StatTile`/
 * `RevenueHero` delta feature already existed and simply went unused), and
 * four widgets that were previously either missing entirely (recent activity,
 * quick actions) or real backend capabilities with no dashboard surface
 * (fulfillment health, returns summary, order-value distribution — see
 * `reports.service.ts`).
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
        fetchTopProducts(range, 5),
        fetchStatusBreakdown(range),
        fetchFulfillmentHealth(range),
        fetchReturnsSummary(range),
        fetchOrderValueDistribution(range),
        fetchAudit({ page: 1, pageSize: 6 }),
      ]);

      setOverview(loadedOverview);
      setPreviousOverview(loadedPreviousOverview);
      setPoints(
        series.points.map((point) => ({
          date: point.date,
          revenue: Number(point.revenue),
        })),
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

  // Names WHICH period a delta compares against — must track `comparison`,
  // never hardcode "previous period" while potentially showing a
  // year-over-year number (checklist 2.14). Deliberately NOT the same
  // strings the comparison picker itself uses ("Previous period") — this is
  // the trailing text on a delta line ("vs previous period"), a different
  // grammatical position that needs its own "vs "-prefixed copy.
  const comparisonLabel = comparison === 'sameLastYear' ? t('vsSameLastYear') : t('vsPreviousPeriod');

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

      <Reveal>
        <div className="grid gap-4 lg:grid-cols-3">
          <RevenueHero
            value={overview ? Number(overview.revenue) : 0}
            deltaPercent={revenueDelta}
            comparisonLabel={comparisonLabel}
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
            Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)
          ) : (
            <>
              <StatTile
                labelKey="totalOrders"
                value={overview.orders}
                deltaPercent={ordersDelta}
                comparisonLabel={comparisonLabel}
                icon="orders"
                href="/admin/orders"
              />
              <StatTile
                labelKey="canceledOrders"
                value={overview.canceledOrders}
                deltaPercent={canceledDelta}
                comparisonLabel={comparisonLabel}
                icon="pending"
                // A rise in cancellations is BAD — without this the tile would
                // paint a spike in them green.
                invertDelta
                href="/admin/orders?status=CANCELED"
              />
              {/* No deltaPercent here on purpose: low-stock is a live snapshot
                  (`stock <= threshold` right now), not scoped to the selected
                  date range on the backend — a period-over-period comparison
                  would just repeat the same number and imply a trend that
                  isn't real. */}
              <StatTile
                labelKey="lowStockProducts"
                value={overview.lowStockProducts}
                icon="inventory"
                invertDelta
                href="/admin/inventory?lowStock=true"
              />
            </>
          )}
        </section>
      </Reveal>

      <Reveal>
        <div className="grid gap-4 lg:grid-cols-2">
          <FulfillmentHealthWidget data={fulfillment} isLoading={isLoading} />
          <ReturnsSummaryWidget data={returns} isLoading={isLoading} />
        </div>
      </Reveal>

      <Reveal>
        <div className="grid gap-4 lg:grid-cols-2">
          <TopProductsWidget data={topProducts} isLoading={isLoading} />
          <StatusBreakdownWidget data={statusBreakdown} isLoading={isLoading} />
        </div>
      </Reveal>

      <Reveal>
        <div className="grid gap-4 lg:grid-cols-2">
          <OrderValueWidget data={orderValue} isLoading={isLoading} />
          <RecentActivityWidget entries={recentActivity} isLoading={isLoading} />
        </div>
      </Reveal>

      <Reveal>
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
  );
}
