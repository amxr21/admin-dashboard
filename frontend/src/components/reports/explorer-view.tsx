'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { EmptyState } from '@/components/empty-state';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import {
  EXPLORER_DIMENSIONS,
  EXPLORER_MEASURES,
  defaultRange,
  fetchExplorer,
  isExplorerDimension,
  type DateRange,
  type Explorer,
  type ExplorerDimension,
  type ExplorerMeasure,
} from '@/lib/reports-api';

/**
 * The generic report viewer (C3.3) — a caller-chosen group-by dimension and
 * measure over the same order-line-item join every domain report already
 * reads (see `getExplorerRows`'s own doc comment on the backend). Not a new
 * fact about the business: every dimension/measure pair here is also
 * reachable through one of the fixed-shape reports (category breakdown, top
 * products, status breakdown) — this is a different LENS on the same data,
 * which is what "generic viewer" is supposed to mean rather than a promise
 * that any arbitrary cut of the schema is available.
 *
 * Chart and table read the SAME sorted rows and the SAME measure accessor —
 * "kept in sync" means there is exactly one source of truth for what's
 * plotted and what's listed, not a second parallel state that could disagree
 * with the first after a re-sort or a measure change.
 */

function isExplorerMeasure(value: string): value is ExplorerMeasure {
  return (EXPLORER_MEASURES as readonly string[]).includes(value);
}

function measureValue(row: Explorer['rows'][number], measure: ExplorerMeasure): number {
  switch (measure) {
    case 'revenue':
      return Number(row.revenue);
    case 'units':
      return row.units;
    case 'orders':
      return row.orders;
    case 'averageOrderValue':
      return Number(row.averageOrderValue);
  }
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { payload?: { label: string; value: number } }[];
  measure: ExplorerMeasure;
  formatMeasure: (measure: ExplorerMeasure, value: number) => string;
}

function ExplorerTooltip({ active, payload, measure, formatMeasure }: ChartTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;

  return (
    <div className="bg-popover text-popover-foreground min-w-40 rounded-md border px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground mb-1 text-xs">{datum.label}</p>
      <p className="font-medium tabular-nums">{formatMeasure(measure, datum.value)}</p>
    </div>
  );
}

export function ExplorerView() {
  const t = useTranslations('reports.explorer');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({
    from: defaults.from,
    to: defaults.to,
    dimension: 'category',
    measure: 'revenue',
  });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);
  const dimension: ExplorerDimension = isExplorerDimension(values.dimension!) ? values.dimension! : 'category';
  const measure: ExplorerMeasure = isExplorerMeasure(values.measure!) ? values.measure! : 'revenue';

  const [data, setData] = useState<Explorer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchExplorer(range, dimension));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, dimension, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  function formatMeasure(m: ExplorerMeasure, value: number): string {
    if (m === 'units' || m === 'orders') return formatter.number(value);
    return formatCurrency(value);
  }

  // Sorted by the CURRENT measure — a click on "Units" re-sorts both the
  // chart and the table by units, not just re-labels an axis that's still
  // ordered by whatever measure was selected before.
  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => measureValue(b, measure) - measureValue(a, measure));
  }, [data, measure]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + measureValue(row, measure), 0), [rows, measure]);

  // Cap the chart at the top 15 rows — a product/category cut can legitimately
  // have dozens of rows, and a bar per row past that renders unreadably thin.
  // The table below is never capped; this only trims what's PLOTTED.
  const chartData = useMemo(
    () => rows.slice(0, 15).map((row) => ({ label: row.label, value: measureValue(row, measure) })),
    [rows, measure],
  );

  const reducedMotion = useReducedMotion();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePresetField
            range={range}
            onChange={(next) => setValues({ from: next.from, to: next.to })}
            idPrefix="explorer"
          />

          <div className="space-y-2">
            <Label htmlFor="explorer-dimension">{t('groupBy')}</Label>
            <Select value={dimension} onValueChange={(next) => setValues({ dimension: next })}>
              <SelectTrigger id="explorer-dimension" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPLORER_DIMENSIONS.map((dim) => (
                  <SelectItem key={dim} value={dim}>
                    {t(`dimensions.${dim}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="explorer-measure">{t('measure')}</Label>
            <Select value={measure} onValueChange={(next) => setValues({ measure: next })}>
              <SelectTrigger id="explorer-measure" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPLORER_MEASURES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`measures.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ExportButton view="explorer" range={range} extra={{ dimension }} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <>
          <div className="bg-card rounded-lg border p-4">
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 32)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                accessibilityLayer
              >
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                  tickFormatter={(value: number) => formatMeasure(measure, value)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={140}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                />
                <Tooltip
                  content={<ExplorerTooltip measure={measure} formatMeasure={formatMeasure} />}
                  cursor={{ fill: 'var(--muted)' }}
                />
                <Bar
                  dataKey="value"
                  fill="var(--chart-1)"
                  radius={4}
                  isAnimationActive={!reducedMotion}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
            {rows.length > chartData.length ? (
              <p className="text-muted-foreground mt-2 text-xs">
                {t('chartTruncated', { shown: chartData.length, total: rows.length })}
              </p>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(`dimensions.${dimension}`)}</TableHead>
                  <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                  <TableHead className="text-end">{t('columns.units')}</TableHead>
                  <TableHead className="text-end">{t('columns.orders')}</TableHead>
                  <TableHead className="text-end">{t('columns.averageOrderValue')}</TableHead>
                  <TableHead className="text-end">{t('columns.percentOfTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key ?? row.label}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.units)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.orders)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCurrency(Number(row.averageOrderValue))}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {total > 0
                        ? formatter.number(measureValue(row, measure) / total, {
                            style: 'percent',
                            maximumFractionDigits: 1,
                          })
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t('total')}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatCurrency(rows.reduce((sum, row) => sum + Number(row.revenue), 0))}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(rows.reduce((sum, row) => sum + row.units, 0))}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(rows.reduce((sum, row) => sum + row.orders, 0))}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">—</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(1, { style: 'percent', maximumFractionDigits: 0 })}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
