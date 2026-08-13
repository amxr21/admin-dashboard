'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { DateRangePresetField } from '@/components/reports/date-range-field';
import { ExportButton } from '@/components/reports/export-button';
import { ErrorSection } from '@/components/errors/error-section';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { defaultRange, fetchInventoryTurnover, type DateRange, type InventoryTurnover } from '@/lib/reports-api';

/**
 * Inventory turnover / dead stock (C3.5) — units sold per product in the
 * window against current stock. Reads `StockMovement`'s SOLD entries, the
 * only real "what actually sold" ledger — see `getInventoryTurnover`'s own
 * comment for why `OrderItem.quantity` isn't the same fact.
 */
export function InventoryTurnoverView() {
  const t = useTranslations('reports.inventoryTurnover');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const defaults = useMemo(() => defaultRange(), []);
  const { values, setValues } = useUrlState({ from: defaults.from, to: defaults.to, tab: 'turnover' });
  const range: DateRange = useMemo(() => ({ from: values.from!, to: values.to! }), [values.from, values.to]);

  const [data, setData] = useState<InventoryTurnover | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchInventoryTurnover(range));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [range, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  function renderRows(rows: InventoryTurnover['turnover']) {
    return rows.map((row) => (
      <TableRow key={row.productId}>
        <TableCell>{row.name}</TableCell>
        <TableCell className="force-ltr">{row.sku ?? '—'}</TableCell>
        <TableCell className="text-end tabular-nums">{formatter.number(row.stock)}</TableCell>
        <TableCell className="text-end tabular-nums">{formatter.number(row.unitsSold)}</TableCell>
      </TableRow>
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePresetField
          range={range}
          onChange={(next) => setValues({ from: next.from, to: next.to })}
          idPrefix="inventory-turnover"
        />
        <ExportButton view="inventory-turnover" range={range} onError={setError} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <div className="space-y-3">
          <div role="tablist" className="bg-muted inline-flex gap-1 rounded-lg p-1">
            <button
              type="button"
              role="tab"
              aria-selected={values.tab !== 'deadStock'}
              onClick={() => setValues({ tab: null })}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                values.tab !== 'deadStock'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('tabs.turnover')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={values.tab === 'deadStock'}
              onClick={() => setValues({ tab: 'deadStock' })}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                values.tab === 'deadStock'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('tabs.deadStock', { count: data?.deadStock.length ?? 0 })}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.product')}</TableHead>
                  <TableHead>{t('columns.sku')}</TableHead>
                  <TableHead className="text-end">{t('columns.stock')}</TableHead>
                  <TableHead className="text-end">{t('columns.unitsSold')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderRows(values.tab === 'deadStock' ? (data?.deadStock ?? []) : (data?.turnover ?? []))}
              </TableBody>
            </Table>
            {values.tab === 'deadStock' && data?.deadStock.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">{t('noDeadStock')}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
