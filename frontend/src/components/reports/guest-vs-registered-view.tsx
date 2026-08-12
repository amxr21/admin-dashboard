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
import { defaultRange, fetchGuestVsRegistered, type DateRange, type GuestVsRegistered } from '@/lib/reports-api';

/**
 * Guest vs. registered orders (C3.5) — orders with no `customerId` (a
 * walk-in checkout, or a customer record later deleted — both look
 * identical after the fact) against orders with a real customer link.
 */
export function GuestVsRegisteredView() {
  const t = useTranslations('reports.guestVsRegistered');
  const tStates = useTranslations('states');
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<GuestVsRegistered | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchGuestVsRegistered(range));
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
          idPrefix="guest-vs-registered"
        />
        <ExportButton view="guest-vs-registered" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('errorTitle')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('guest')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatCurrency(Number(data?.guest.revenue ?? 0))}
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {t('orders', { count: data?.guest.orders ?? 0 })}
            </p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('registered')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatCurrency(Number(data?.registered.revenue ?? 0))}
            </p>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {t('orders', { count: data?.registered.orders ?? 0 })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
