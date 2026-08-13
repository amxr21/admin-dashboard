'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { defaultRange, fetchProductMargin, type DateRange, type ProductMargin } from '@/lib/reports-api';

/**
 * Product margin (C3.5) — revenue, COGS and gross margin per product, for
 * products with a recorded `cost` ONLY. `productsWithoutCost` states the
 * gap explicitly rather than letting the table's shorter-than-expected
 * length imply it silently — see `getProductMargin`'s own comment.
 */
export function ProductMarginView() {
  const t = useTranslations('reports.productMargin');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<ProductMargin | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchProductMargin(range));
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
          idPrefix="product-margin"
        />
        <ExportButton view="product-margin" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <>
          {data && data.productsWithoutCost > 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('productsWithoutCost', { count: data.productsWithoutCost })}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.product')}</TableHead>
                  <TableHead className="text-end">{t('columns.revenue')}</TableHead>
                  <TableHead className="text-end">{t('columns.cogs')}</TableHead>
                  <TableHead className="text-end">{t('columns.margin')}</TableHead>
                  <TableHead className="text-end">{t('columns.marginPercent')}</TableHead>
                  <TableHead className="text-end">{t('columns.units')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.products.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.revenue))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.cogs))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(row.margin))}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatter.number(row.marginPercent, { style: 'percent', maximumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.units)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.products.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
