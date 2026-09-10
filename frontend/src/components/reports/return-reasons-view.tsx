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
import { defaultRange, fetchReturnReasons, type DateRange, type ReturnReasons } from '@/lib/reports-api';

/**
 * Return reasons (C3.5) — a flat, readable export of the return's own
 * free-text reason. Deliberately does NOT attempt keyword-based
 * categorisation — that would fabricate a taxonomy the schema doesn't have.
 * Meant for a human to read, not to chart.
 */
export function ReturnReasonsView() {
  const t = useTranslations('reports.returnReasons');
  const tStates = useTranslations('states');
  const formatter = useFormatter();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchReturnReasons(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<ReturnReasons>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="return-reasons"
        />
        <ExportButton view="return-reasons" range={range} onError={setError} />
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
                <TableHead>{t('columns.rma')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.reason')}</TableHead>
                <TableHead>{t('columns.requestedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.returns.map((row) => (
                <TableRow key={row.rmaNumber}>
                  <TableCell className="force-ltr">{row.rmaNumber}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{row.reason}</TableCell>
                  <TableCell>{formatter.dateTime(new Date(row.createdAt), 'short')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.returns.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
