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
import { defaultRange, fetchProductMargin, type DateRange, type ProductMargin } from '@/lib/reports-api';

/**
 * Product margin (C3.5) — revenue, COGS and gross margin per product, for
 * order lines with a recorded cost ONLY. `orderLinesWithoutCost` states the
 * gap explicitly rather than letting the table's shorter-than-expected
 * length imply it silently — see `getProductMargin`'s own comment.
 *
 * COGS reads the per-line cost SNAPSHOT (F1.1), not the product's live cost,
 * so a supplier price change no longer rewrites past profit.
 */
export function ProductMarginView() {
  const t = useTranslations('reports.productMargin');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchProductMargin(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<ProductMargin>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="product-margin"
        />
        <ExportButton view="product-margin" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <>
          {data && data.orderLinesWithoutCost > 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('orderLinesWithoutCost', { count: data.orderLinesWithoutCost })}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.product')}</TableHead>
                  <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                  <TableHead className="text-end">{t('columns.cogs')}</TableHead>
                  <TableHead className="text-end">{t('columns.margin')}</TableHead>
                  <TableHead className="text-end">{t('columns.marginPercent')}</TableHead>
                  <TableHead className="text-end">{t('columns.units')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.products.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.cogs))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.margin))}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatter.number(row.marginPercent, { style: 'percent', maximumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.units)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.products.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
