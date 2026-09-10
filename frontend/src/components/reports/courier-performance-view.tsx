'use client';

import { useCallback, useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { LoadingState } from '@/components/ui/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReportQuery } from '@/hooks/useReportQuery';
import { useUrlState } from '@/hooks/useUrlState';
import {
  defaultRange,
  fetchCourierPerformance,
  type CourierPerformance,
  type DateRange,
} from '@/lib/reports-api';

/**
 * Courier performance (C3.5) — per-courier count of assignments by CURRENT
 * status, in the window. Reports "how many jobs are in each state per
 * courier right now," not per-leg timing — there is no
 * `DeliveryStatusHistory` table.
 */
export function CourierPerformanceView() {
  const t = useTranslations('reports.courierPerformance');
  const tStates = useTranslations('states');
  const formatter = useFormatter();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchCourierPerformance(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<CourierPerformance>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="courier-performance"
        />
        <ExportButton view="courier-performance" range={range} onError={setError} />
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
                <TableHead>{t('columns.courier')}</TableHead>
                <TableHead className="text-end">{t('columns.total')}</TableHead>
                <TableHead className="text-end">{t('columns.delivered')}</TableHead>
                <TableHead className="text-end">{t('columns.outForDelivery')}</TableHead>
                <TableHead className="text-end">{t('columns.canceled')}</TableHead>
                <TableHead className="text-end">{t('columns.returned')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.couriers.map((row) => (
                <TableRow key={row.driverId}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.total)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(row.byStatus['DELIVERED'] ?? 0)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(row.byStatus['OUT_FOR_DELIVERY'] ?? 0)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(row.byStatus['CANCELED'] ?? 0)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatter.number(row.byStatus['RETURNED'] ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.couriers.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
