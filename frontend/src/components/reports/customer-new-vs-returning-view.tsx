'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { LoadingState } from '@/components/ui/loading-state';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useReportQuery } from '@/hooks/useReportQuery';
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

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchCustomerNewVsReturning(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<CustomerNewVsReturning>(query);

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
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (data?.new.orders ?? 0) + (data?.returning.orders ?? 0) === 0 ? (
        /**
         * F4.5 — an empty period must SAY it is empty.
         *
         * This used to fall through to the tiles below, where `?? 0` rendered
         * a confident "AED 0.00 / 0 orders". That is indistinguishable from a
         * real measured zero, and it is the same fabrication the revenue
         * chart's gap rule exists to prevent: "nothing was sold" and "nothing
         * was recorded" read identically, so the reader cannot tell whether
         * the business had a quiet month or the report is broken.
         */
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
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
