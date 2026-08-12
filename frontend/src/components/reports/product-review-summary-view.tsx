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
  fetchProductReviewSummary,
  type DateRange,
  type ProductReviewSummary,
} from '@/lib/reports-api';

/**
 * Product review-rating summary (C3.5) — average rating, review count and
 * the 1-5 star distribution per product, APPROVED reviews only (a PENDING
 * or REJECTED review is not yet/never a verified opinion).
 */
export function ProductReviewSummaryView() {
  const t = useTranslations('reports.productReviewSummary');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<ProductReviewSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchProductReviewSummary(range));
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
          idPrefix="product-review-summary"
        />
        <ExportButton view="product-review-summary" range={range} onError={setError} />
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
                <TableHead>{t('columns.product')}</TableHead>
                <TableHead className="text-end">{t('columns.reviews')}</TableHead>
                <TableHead className="text-end">{t('columns.averageRating')}</TableHead>
                <TableHead className="text-end">5★</TableHead>
                <TableHead className="text-end">4★</TableHead>
                <TableHead className="text-end">3★</TableHead>
                <TableHead className="text-end">2★</TableHead>
                <TableHead className="text-end">1★</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.products.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.reviewCount)}</TableCell>
                  <TableCell className="text-end tabular-nums">{row.averageRating.toFixed(1)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.distribution['5'])}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.distribution['4'])}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.distribution['3'])}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.distribution['2'])}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.distribution['1'])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.products.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
