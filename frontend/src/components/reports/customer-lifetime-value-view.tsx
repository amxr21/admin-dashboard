'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchCustomerLifetimeValue, type CustomerLifetimeValue } from '@/lib/reports-api';

/** LTV has no date range (it's an all-time total) — the export route
 *  ignores `from`/`to` entirely (see `ltvQuery` in reports.route.ts), so
 *  `ExportButton`'s range prop is satisfied with a value the backend never
 *  reads rather than making the shared button's `range` prop optional for
 *  this one case. */
const NO_RANGE = { from: '', to: '' };

/**
 * Customer lifetime value (C3.5) — top customers by ALL-TIME revenue, not
 * scoped to a date range: LTV is a running total by definition, so there is
 * no "range" control here, same as `getNeedsAttention`'s live-state reports.
 */
export function CustomerLifetimeValueView() {
  const t = useTranslations('reports.customerLifetimeValue');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const [data, setData] = useState<CustomerLifetimeValue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchCustomerLifetimeValue());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton view="customer-lifetime-value" range={NO_RANGE} onError={setError} />
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
                <TableHead>{t('columns.customer')}</TableHead>
                <TableHead>{t('columns.email')}</TableHead>
                <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                <TableHead className="text-end">{t('columns.orders')}</TableHead>
                <TableHead className="text-end">{t('columns.averageOrderValue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.customers.map((row) => (
                <TableRow key={row.customerId}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="force-ltr">{row.email}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.orders)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatCurrency(Number(row.averageOrderValue))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.customers.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
