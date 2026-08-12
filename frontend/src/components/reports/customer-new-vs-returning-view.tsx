'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import {
  defaultRange,
  fetchCustomerNewVsReturning,
  type CustomerNewVsReturning,
  type DateRange,
} from '@/lib/reports-api';

/**
 * New vs. returning customer revenue (C3.5) — every order in the window
 * classified by whether it was that customer's first order ever. A guest
 * order (no customer link) is bucketed under "new" — it has no prior
 * relationship to bank on, same as a genuine first-time customer.
 */
export function CustomerNewVsReturningView() {
  const t = useTranslations('reports.customerNewVsReturning');
  const tStates = useTranslations('states');
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<CustomerNewVsReturning | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchCustomerNewVsReturning(range));
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
          idPrefix="customer-new-vs-returning"
        />
        <ExportButton view="customer-new-vs-returning" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('errorTitle')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('new')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatCurrency(Number(data?.new.revenue ?? 0))}
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {t('orders', { count: data?.new.orders ?? 0 })}
            </p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('returning')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatCurrency(Number(data?.returning.revenue ?? 0))}
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {t('orders', { count: data?.returning.orders ?? 0 })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
