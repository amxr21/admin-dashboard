'use client';

import { useCallback, useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { LoadingState } from '@/components/ui/loading-state';
import { useReportQuery } from '@/hooks/useReportQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { defaultRange, fetchDeliveryCycleTime, type DateRange, type DeliveryCycleTime } from '@/lib/reports-api';

/**
 * Delivery cycle time (C3.5) — average/median hours from assignment
 * creation to delivery, restricted to currently-DELIVERED assignments (the
 * only case `updatedAt` can be trusted as the delivery timestamp — see
 * `getDeliveryCycleTime`'s own comment on why this is a proxy, not a full
 * per-leg audit trail like orders have).
 */
export function DeliveryCycleTimeView() {
  const t = useTranslations('reports.deliveryCycleTime');
  const tStates = useTranslations('states');
  const formatter = useFormatter();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const query = useCallback(() => fetchDeliveryCycleTime(range), [range]);
  const { data, isLoading, error, setError, load } = useReportQuery<DeliveryCycleTime>(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="delivery-cycle-time"
        />
        <ExportButton view="delivery-cycle-time" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        /**
         * F4.5 — deliberately NO empty branch here, unlike the other five
         * reports in that change.
         *
         * This view already handled it honestly: `averageHours`/`medianHours`
         * are nullable at the API and render an em dash, so an empty period
         * shows "0 delivered, — avg, — median". That is a truthful statement
         * of a real fact (nothing was delivered) rather than a fabricated
         * measurement, and a test already asserted it.
         *
         * Replacing it with an EmptyState lost information: the reader could
         * no longer see that the delivered COUNT is a real, measured zero.
         */
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('deliveredCount')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatter.number(data?.deliveredCount ?? 0)}</p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('averageHours')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {data?.averageHours != null ? data.averageHours.toFixed(1) : '—'}
            </p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('medianHours')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{data?.medianHours ?? '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
