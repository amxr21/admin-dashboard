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
import {
  defaultRange,
  fetchReturnResolutionBreakdown,
  type DateRange,
  type ReturnResolutionBreakdown,
} from '@/lib/reports-api';

/**
 * Return resolution breakdown (C3.5) — counts and refunded value by
 * resolution (REFUND/STORE_CREDIT/REPLACEMENT/NONE) and by status
 * (REQUESTED/APPROVED/REJECTED). `resolution` is only ever set as part of
 * the real approve-return procedure, not a stray editable field.
 */
export function ReturnResolutionBreakdownView() {
  const t = useTranslations('reports.returnResolutionBreakdown');
  const tResolutions = useTranslations('reports.returnResolutionBreakdown.resolutions');
  const tStatuses = useTranslations('reports.returnResolutionBreakdown.statuses');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<ReturnResolutionBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchReturnResolutionBreakdown(range));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  function resolutionLabel(resolution: string): string {
    return tResolutions.has(resolution) ? tResolutions(resolution) : resolution;
  }
  function statusLabel(status: string): string {
    return tStatuses.has(status) ? tStatuses(status) : status;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="return-resolution-breakdown"
        />
        <ExportButton view="return-resolution-breakdown" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.resolution')}</TableHead>
                  <TableHead className="text-end">{t('columns.count')}</TableHead>
                  <TableHead className="text-end">{t('columns.refundedValue')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.byResolution.map((row) => (
                  <TableRow key={row.resolution}>
                    <TableCell>{resolutionLabel(row.resolution)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.count)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.refundedValue))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead className="text-end">{t('columns.count')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.byStatus.map((row) => (
                  <TableRow key={row.status}>
                    <TableCell>{statusLabel(row.status)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
