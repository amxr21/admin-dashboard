'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { EmptyState } from '@/components/empty-state';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchLowStockSnapshot, type LowStockSnapshot } from '@/lib/reports-api';

/** No date range — the export route ignores from/to (live catalogue
 *  snapshot); a dummy DateRange satisfies the shared ExportButton's prop. */
const NO_RANGE = { from: '', to: '' };

/**
 * Low-stock / stockout snapshot (C3.5) — every active product at or below
 * the LIVE low-stock threshold setting, with days since last restock. Live
 * catalogue state, not date-range scoped, same as needs-attention.
 */
export function LowStockSnapshotView() {
  const t = useTranslations('reports.lowStockSnapshot');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [data, setData] = useState<LowStockSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchLowStockSnapshot());
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
      <div className="flex items-center justify-between gap-3">
        {data ? <p className="text-muted-foreground text-sm">{t('threshold', { count: data.threshold })}</p> : <div />}
        <ExportButton view="low-stock-snapshot" range={NO_RANGE} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : data?.products.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.product')}</TableHead>
                <TableHead>{t('columns.sku')}</TableHead>
                <TableHead className="text-end">{t('columns.stock')}</TableHead>
                <TableHead className="text-end">{t('columns.daysSinceRestock')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.products.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="force-ltr">{row.sku ?? '—'}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatter.number(row.stock)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {row.daysSinceLastRestock ?? t('neverRestocked')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
