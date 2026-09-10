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
import { defaultRange, fetchCustomerGeography, type CustomerGeography, type DateRange } from '@/lib/reports-api';

/**
 * Customer geography (C3.5) — revenue and orders grouped by the customer's
 * recorded city/country. A guest order (no customer link, or a customer
 * later deleted) falls into an explicit "(unknown)" bucket rather than
 * being dropped — see `getCustomerGeography`'s own comment.
 */
export function CustomerGeographyView() {
  const t = useTranslations('reports.customerGeography');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchCustomerGeography(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<CustomerGeography>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="customer-geography"
        />
        <ExportButton view="customer-geography" range={range} onError={setError} />
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
                <TableHead>{t('columns.city')}</TableHead>
                <TableHead>{t('columns.country')}</TableHead>
                <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                <TableHead className="text-end">{t('columns.orders')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((row) => (
                <TableRow key={`${row.city}-${row.country}`}>
                  <TableCell>{row.city}</TableCell>
                  <TableCell>{row.country}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.orders)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
