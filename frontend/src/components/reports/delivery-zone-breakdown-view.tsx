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
  fetchDeliveryZoneBreakdown,
  type DateRange,
  type DeliveryZoneBreakdown,
} from '@/lib/reports-api';

/**
 * Delivery zone breakdown (C3.5) — assignment counts and collectible value
 * grouped by the COURIER's own home zone/region, used as a proxy for
 * delivery area since `DeliveryAssignment.area` is never written by any
 * real code path — see `getDeliveryZoneBreakdown`'s own comment.
 */
export function DeliveryZoneBreakdownView() {
  const t = useTranslations('reports.deliveryZoneBreakdown');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchDeliveryZoneBreakdown(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<DeliveryZoneBreakdown>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="delivery-zone-breakdown"
        />
        <ExportButton view="delivery-zone-breakdown" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{t('proxyNote')}</p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.zone')}</TableHead>
                  <TableHead>{t('columns.region')}</TableHead>
                  <TableHead className="text-end">{t('columns.assignments')}</TableHead>
                  <TableHead className="text-end">{t('columns.collectibleValue')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.zones.map((row) => (
                  <TableRow key={`${row.zone}-${row.region}`}>
                    <TableCell>{row.zone}</TableCell>
                    <TableCell>{row.region}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.assignments)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCurrency(Number(row.collectibleValue))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.zones.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
