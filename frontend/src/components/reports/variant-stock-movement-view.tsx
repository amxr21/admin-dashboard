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
  fetchVariantStockMovement,
  type DateRange,
  type VariantStockMovement,
} from '@/lib/reports-api';

/**
 * Variant-level stock movement (C3.5) — same movement-ledger shape as
 * inventory turnover, scoped to `ProductVariant` via its own real
 * `StockMovement` rows (`variantId`), not a re-derivation of product-level
 * data.
 */
export function VariantStockMovementView() {
  const t = useTranslations('reports.variantStockMovement');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<VariantStockMovement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchVariantStockMovement(range));
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
          idPrefix="variant-stock-movement"
        />
        <ExportButton view="variant-stock-movement" range={range} onError={setError} />
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
                <TableHead>{t('columns.variant')}</TableHead>
                <TableHead>{t('columns.sku')}</TableHead>
                <TableHead className="text-end">{t('columns.stock')}</TableHead>
                <TableHead className="text-end">{t('columns.sold')}</TableHead>
                <TableHead className="text-end">{t('columns.received')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.variants.map((row) => (
                <TableRow key={row.variantId}>
                  <TableCell>{row.productName}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="force-ltr">{row.sku ?? '—'}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.stock)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.sold)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.received)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.variants.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
