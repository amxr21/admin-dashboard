'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import {
  defaultRange,
  fetchReviewModerationThroughput,
  type DateRange,
  type ReviewModerationThroughput,
} from '@/lib/reports-api';

/**
 * Review moderation throughput (C3.5) — submitted/approved/rejected/pending
 * counts plus average hours to moderation. A PENDING review has no
 * moderation timestamp yet, so it's counted but excluded from the average.
 */
export function ReviewModerationThroughputView() {
  const t = useTranslations('reports.reviewModerationThroughput');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<ReviewModerationThroughput | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchReviewModerationThroughput(range));
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
          idPrefix="review-moderation-throughput"
        />
        <ExportButton view="review-moderation-throughput" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('submitted')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatter.number(data?.submitted ?? 0)}</p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('approved')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatter.number(data?.approved ?? 0)}</p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('rejected')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatter.number(data?.rejected ?? 0)}</p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('pending')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatter.number(data?.pending ?? 0)}</p>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-sm font-medium">{t('averageHours')}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {data?.averageHoursToModeration != null ? data.averageHoursToModeration.toFixed(1) : '—'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
