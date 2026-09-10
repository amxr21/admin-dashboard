'use client';

import { useCallback, useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { LoadingState } from '@/components/ui/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useReportQuery } from '@/hooks/useReportQuery';
import { useUrlState } from '@/hooks/useUrlState';
import {
  defaultRange,
  fetchCategoryBreakdown,
  type CategoryBreakdown,
  type DateRange,
} from '@/lib/reports-api';

/**
 * Per-category breakdown (C3.5) — revenue and units by product category, one
 * flat level. NOT a hierarchy rollup: `Category` has no parent/child nesting
 * yet (Track D's S7.6, unbuilt) — see `getCategoryBreakdown`'s own comment.
 */
export function CategoryBreakdownView() {
  const t = useTranslations('reports.categoryBreakdown');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchCategoryBreakdown(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<CategoryBreakdown>(query);

  const totalRevenue = data?.categories.reduce((sum, row) => sum + Number(row.revenue), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="category-breakdown"
        />
        <ExportButton view="category-breakdown" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.category')}</TableHead>
                <TableHead className="text-end">{t('columns.units')}</TableHead>
                <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                <TableHead className="text-end">{t('columns.percentOfTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.categories.map((row) => (
                <TableRow key={row.categoryId ?? 'uncategorised'}>
                  <TableCell>{row.categoryName}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.units)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {totalRevenue > 0 ? formatter.number(Number(row.revenue) / totalRevenue, { style: 'percent', maximumFractionDigits: 1 }) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.categories.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
