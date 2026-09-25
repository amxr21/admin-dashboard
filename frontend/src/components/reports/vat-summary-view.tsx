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
import { defaultRange, fetchVatSummary, type DateRange, type VatSummary } from '@/lib/reports-api';

/**
 * VAT charged on sales less VAT paid back on refunds, by month. Every figure
 * is a snapshot from checkout or refund approval; rows from before those
 * snapshots existed are counted in their own columns rather than guessed.
 */
export function VatSummaryView() {
  const t = useTranslations('reports.vatSummary');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchVatSummary(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<VatSummary>(query);

  const unrecorded = data
    ? data.points.reduce((sum, row) => sum + row.ordersNotRecorded + row.refundsNotRecorded, 0)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="vat-summary"
        />
        <ExportButton view="vat-summary" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <>
          {data ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              {(['vatCharged', 'vatRefunded', 'netVat'] as const).map((key) => (
                <div key={key} className="bg-card rounded-lg border p-4">
                  <dt className="text-muted-foreground text-sm">{t(`columns.${key}`)}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {formatCurrency(Number(data.totals[key]))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {unrecorded > 0 ? (
            <p className="text-muted-foreground text-sm" role="note">
              {t('notRecordedNote')}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.month')}</TableHead>
                  <TableHead className="text-end">{t('columns.vatCharged')}</TableHead>
                  <TableHead className="text-end">{t('columns.vatRefunded')}</TableHead>
                  <TableHead className="text-end">{t('columns.netVat')}</TableHead>
                  <TableHead className="text-end">{t('columns.ordersNotRecorded')}</TableHead>
                  <TableHead className="text-end">{t('columns.refundsNotRecorded')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.points.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell>
                      <time dateTime={row.date}>
                        {formatter.dateTime(new Date(row.date), { year: 'numeric', month: 'long' })}
                      </time>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.vatCharged))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.vatRefunded))}</TableCell>
                    <TableCell className="text-end font-medium tabular-nums">{formatCurrency(Number(row.netVat))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.ordersNotRecorded)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.refundsNotRecorded)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.points.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}