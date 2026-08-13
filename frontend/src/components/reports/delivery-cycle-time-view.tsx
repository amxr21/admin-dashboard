'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
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
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<DeliveryCycleTime | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchDeliveryCycleTime(range));
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
          idPrefix="delivery-cycle-time"
        />
        <ExportButton view="delivery-cycle-time" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
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
