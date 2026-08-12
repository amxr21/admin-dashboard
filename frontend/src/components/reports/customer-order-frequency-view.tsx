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
  fetchCustomerOrderFrequency,
  type CustomerOrderFrequency,
  type DateRange,
} from '@/lib/reports-api';

/**
 * Customer order frequency (C3.5) — how many orders each customer placed in
 * the window, bucketed 1/2/3/4+, plus a headline repeat-purchase rate.
 * Guest orders are excluded entirely from the per-customer count — see
 * `getCustomerOrderFrequency`'s own comment on why.
 */
export function CustomerOrderFrequencyView() {
  const t = useTranslations('reports.customerOrderFrequency');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<CustomerOrderFrequency | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchCustomerOrderFrequency(range));
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
          idPrefix="customer-order-frequency"
        />
        <ExportButton view="customer-order-frequency" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('errorTitle')} description={error} onRetry={() => void load()} />
      ) : (
        <>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('repeatRate')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatter.number(data?.repeatRate ?? 0, { style: 'percent', maximumFractionDigits: 1 })}
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {t('totalCustomers', { count: data?.totalCustomers ?? 0 })}
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.ordersPlaced')}</TableHead>
                  <TableHead className="text-end">{t('columns.customers')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.buckets.map((bucket) => (
                  <TableRow key={bucket.label}>
                    <TableCell>{bucket.label}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(bucket.customers)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
