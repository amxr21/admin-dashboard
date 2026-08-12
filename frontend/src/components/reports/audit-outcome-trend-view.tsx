'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { defaultRange, fetchAuditOutcomeTrend, type AuditOutcomeTrend, type DateRange } from '@/lib/reports-api';

/**
 * Security/audit outcome trend (C3.5) — count of audit rows by outcome
 * (SUCCESS/DENIED/ERROR), bucketed daily. ERROR is a declared value no code
 * path currently sets — it reads as an honest zero rather than being
 * omitted from the shape.
 */
export function AuditOutcomeTrendView() {
  const t = useTranslations('reports.auditOutcomeTrend');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<AuditOutcomeTrend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchAuditOutcomeTrend(range));
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
          idPrefix="audit-outcome-trend"
        />
        <ExportButton view="audit-outcome-trend" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('errorTitle')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.date')}</TableHead>
                <TableHead className="text-end">{t('columns.success')}</TableHead>
                <TableHead className="text-end">{t('columns.denied')}</TableHead>
                <TableHead className="text-end">{t('columns.error')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.points.map((row) => (
                <TableRow key={row.date}>
                  <TableCell>
                    <time dateTime={row.date}>{formatter.dateTime(new Date(row.date), 'short')}</time>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.success)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.denied)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.error)}</TableCell>
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
