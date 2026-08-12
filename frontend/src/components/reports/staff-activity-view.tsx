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
import { defaultRange, fetchStaffActivity, type DateRange, type StaffActivity } from '@/lib/reports-api';

/**
 * Staff activity (C3.5) — who did what, how often, in the selected window.
 * Reads the same `AuditLog` the audit viewer does, grouped by actor rather
 * than shown row-by-row — that detail view already exists at `/admin/audit`.
 */
export function StaffActivityView() {
  const t = useTranslations('reports.staffActivity');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<StaffActivity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchStaffActivity(range));
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
          idPrefix="staff-activity"
        />
        <ExportButton view="staff-activity" range={range} onError={setError} />
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
                <TableHead>{t('columns.actor')}</TableHead>
                <TableHead>{t('columns.role')}</TableHead>
                <TableHead className="text-end">{t('columns.actions')}</TableHead>
                <TableHead className="text-end">{t('columns.denied')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.staff.map((row) => (
                <TableRow key={`${row.actorId ?? ''}-${row.actorEmail}`}>
                  <TableCell className="force-ltr">{row.actorEmail}</TableCell>
                  <TableCell>{row.actorRole ?? '—'}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.actionCount)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.deniedCount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.staff.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
