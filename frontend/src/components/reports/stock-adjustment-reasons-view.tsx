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
import {
  defaultRange,
  fetchStockAdjustmentReasons,
  type DateRange,
  type StockAdjustmentReasons,
} from '@/lib/reports-api';

/**
 * Stock adjustment reasons (C3.5) — units and movement count by
 * `StockMovementReason` — "why did stock move." `netUnits` is kept signed
 * (RECEIVED positive, DAMAGED/LOST negative) rather than flattened to an
 * absolute value.
 */
export function StockAdjustmentReasonsView() {
  const t = useTranslations('reports.stockAdjustmentReasons');
  const tReasons = useTranslations('reports.stockMovementReasons');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<StockAdjustmentReasons | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchStockAdjustmentReasons(range));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  function reasonLabel(reason: string): string {
    return tReasons.has(reason) ? tReasons(reason) : reason;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="stock-adjustment-reasons"
        />
        <ExportButton view="stock-adjustment-reasons" range={range} onError={setError} />
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
                <TableHead>{t('columns.reason')}</TableHead>
                <TableHead className="text-end">{t('columns.movements')}</TableHead>
                <TableHead className="text-end">{t('columns.netUnits')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.reasons.map((row) => (
                <TableRow key={row.reason}>
                  <TableCell>{reasonLabel(row.reason)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.movements)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.netUnits)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.reasons.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
