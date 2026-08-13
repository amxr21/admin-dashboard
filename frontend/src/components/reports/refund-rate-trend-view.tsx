'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { defaultRange, fetchRefundRateTrend, type DateRange, type RefundRateTrend } from '@/lib/reports-api';

/**
 * Refund-rate trend (C3.5) — refunded value as a share of revenue, by month.
 * Distinct from the overview's single-window returns summary: this is the
 * shape needed to answer "is our refund rate getting better or worse."
 */
export function RefundRateTrendView() {
  const t = useTranslations('reports.refundRateTrend');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<RefundRateTrend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchRefundRateTrend(range));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="refund-rate-trend"
        />
        <ExportButton view="refund-rate-trend" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.month')}</TableHead>
                <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                <TableHead className="text-end">{t('columns.refunded')}</TableHead>
                <TableHead className="text-end">{t('columns.refundRate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.points.map((row) => (
                <TableRow key={row.date}>
                  <TableCell>
                    <time dateTime={row.date}>{formatter.dateTime(new Date(row.date), { year: 'numeric', month: 'long' })}</time>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.refunded))}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(row.refundRate, { style: 'percent', maximumFractionDigits: 1 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.points.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
