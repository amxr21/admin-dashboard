'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Download } from 'lucide-react';

import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { ErrorSection } from '@/components/errors/error-section';
import { DateRangeField } from '@/components/reports/date-range-field';
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
import { StatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  GRANULARITIES,
  defaultRange,
  downloadReportCsv,
  fetchOverview,
  fetchRevenue,
  fetchStatusBreakdown,
  fetchTopProducts,
  fillRevenueGaps,
  type Granularity,
  type Overview,
  type ReportView,
  type StatusBreakdown,
  type TopProducts,
} from '@/lib/reports-api';

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
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [range, setRange] = useState(defaultRange);
  const [granularity, setGranularity] = useState<Granularity>('day');

  const [overview, setOverview] = useState<Overview | null>(null);
  const [points, setPoints] = useState<RevenuePoint[]>([]);
  const [top, setTop] = useState<TopProducts | null>(null);
  const [breakdown, setBreakdown] = useState<StatusBreakdown | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingView, setExportingView] = useState<ReportView | null>(null);

  const handleExport = useCallback(
    async (view: ReportView, extra?: Record<string, string | number | undefined>) => {
      setExportingView(view);
      setError(null);

      try {
        await downloadReportCsv(view, range, extra);
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
      // One window, four questions — asked together so every panel describes
      // the same period rather than drifting as each lands.
      const [loadedOverview, series, loadedTop, loadedBreakdown] = await Promise.all([
        fetchOverview(range),
        fetchRevenue(range, granularity),
        fetchTopProducts(range, 10),
        fetchStatusBreakdown(range),
      ]);

      setOverview(loadedOverview);
      setPoints(fillRevenueGaps(series.points, range, granularity));
      setTop(loadedTop);
      setBreakdown(loadedBreakdown);
    } catch (caught) {
      // A 400 here is a REASON — "choose a range of 731 days or fewer" — and
      // it names the limit. Flattening it would hide the fix.
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
      setOverview(null);
    } finally {
      setIsLoading(false);
    }
  }, [range, granularity, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangeField range={range} onChange={setRange} idPrefix="reports" />

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

        <Button variant="outline" onClick={() => setRange(defaultRange())}>
          {t('reset')}
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading || !overview
            ? Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))
            : (
                [
                  { key: 'revenue', value: formatter.number(Number(overview.revenue), 'currency') },
                  { key: 'orders', value: formatter.number(overview.orders) },
                  {
                    key: 'averageOrderValue',
                    value: formatter.number(Number(overview.averageOrderValue), 'currency'),
                  },
                  { key: 'newCustomers', value: formatter.number(overview.newCustomers) },
                ] as const
              ).map((tile) => (
                <div key={tile.key} className="bg-card rounded-lg border p-4">
                  <p className="text-muted-foreground text-sm">{t(`tiles.${tile.key}`)}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
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
        <RevenueChart data={points} granularity={granularity} isLoading={isLoading} error={null} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t('topProducts')}</h2>
            <ExportButton
              label={t('exportCsv')}
              sectionLabel={t('topProducts')}
              isBusy={exportingView === 'top-products'}
              onExport={() => void handleExport('top-products', { limit: 10 })}
            />
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : top && top.products.length > 0 ? (
            <ol className="space-y-2">
              {top.products.map((product, index) => (
                <li
                  key={product.productId ?? `deleted-${String(index)}`}
                  className="flex items-baseline justify-between gap-3 border-b pb-2"
                >
                  <span className="min-w-0 truncate">
                    {/* Null when the product was hard-deleted — line items keep
                        a price snapshot but no name, so there is nothing to
                        fall back to and saying so beats a blank row. */}
                    {product.name ?? (
                      <em className="text-muted-foreground">{t('deletedProduct')}</em>
                    )}
                    <span className="text-muted-foreground ms-2 text-sm tabular-nums">
                      ×{formatter.number(product.quantity)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatter.number(Number(product.revenue), 'currency')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-sm">{t('noSales')}</p>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t('statusBreakdown')}</h2>
            <ExportButton
              label={t('exportCsv')}
              sectionLabel={t('statusBreakdown')}
              isBusy={exportingView === 'status-breakdown'}
              onExport={() => void handleExport('status-breakdown')}
            />
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ul className="space-y-2">
              {(breakdown?.statuses ?? []).map((row) => (
                <li
                  key={row.status}
                  className="flex items-center justify-between gap-3 border-b pb-2"
                >
                  <StatusBadge kind="orderStatus" value={row.status} />
                  <span className="text-sm tabular-nums">
                    {/* Zeroes are shown, not hidden: a missing row reads as
                        missing data, an explicit 0 reads as "none happened". */}
                    {formatter.number(row.orders)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
