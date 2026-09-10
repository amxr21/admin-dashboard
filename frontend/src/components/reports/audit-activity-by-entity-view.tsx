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
  fetchAuditActivityByEntity,
  type AuditActivityByEntity,
  type DateRange,
} from '@/lib/reports-api';

/**
 * Audit activity by entity/action (C3.5) — which resources/actions are
 * touched most often in the window. Both fields are populated on every
 * single audit row by the choke-point design in `AuditLog`'s own schema
 * comment — the most solidly-populated table in the schema.
 */
export function AuditActivityByEntityView() {
  const t = useTranslations('reports.auditActivityByEntity');
  const tStates = useTranslations('states');
  const formatter = useFormatter();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchAuditActivityByEntity(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<AuditActivityByEntity>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="audit-activity-by-entity"
        />
        <ExportButton view="audit-activity-by-entity" range={range} onError={setError} />
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
                <TableHead>{t('columns.entity')}</TableHead>
                <TableHead>{t('columns.action')}</TableHead>
                <TableHead className="text-end">{t('columns.count')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((row) => (
                <TableRow key={`${row.entity}-${row.action}`}>
                  <TableCell>{row.entity}</TableCell>
                  <TableCell className="force-ltr">{row.action}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.count)}</TableCell>
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
