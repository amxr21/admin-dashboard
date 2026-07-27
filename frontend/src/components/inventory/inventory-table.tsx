'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { History, Search, SlidersHorizontal } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { MovementLogSheet } from '@/components/inventory/movement-log-sheet';
import { StockAdjustSheet } from '@/components/inventory/stock-adjust-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchInventory,
  type InventoryListResult,
  type InventoryRow,
} from '@/lib/inventory-api';

/**
 * Stock levels, with the two things you actually do to them: adjust, and see
 * why it is what it is.
 *
 * ─── THE LOW-STOCK RULE LIVES ON THE SERVER ──────────────────────────
 * Rows arrive with `isLow` already computed and the response carries the
 * `threshold` that produced it. Nothing here re-implements the comparison, so
 * the badge and the filter can never disagree with each other or with the API.
 */

const PAGE_SIZE = 20;

export function InventoryTable() {
  const t = useTranslations('inventory');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [result, setResult] = useState<InventoryListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [viewingLog, setViewingLog] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchInventory({
          page,
          pageSize: PAGE_SIZE,
          ...(search ? { search } : {}),
          ...(lowOnly ? { lowStock: true } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, lowOnly, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const columns: readonly Column<InventoryRow>[] = [
    {
      id: 'name',
      header: t('columns.product'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.sku ? (
            // force-ltr: a SKU is a code and must not reorder in Arabic.
            <p className="text-muted-foreground force-ltr truncate text-xs">{row.sku}</p>
          ) : null}
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (row) => row.category?.name ?? '—',
      sortValue: (row) => row.category?.name ?? null,
    },
    {
      id: 'stock',
      header: t('columns.stock'),
      align: 'end',
      cell: (row) => (
        <span
          className={
            row.isLow ? 'text-destructive font-medium tabular-nums' : 'tabular-nums'
          }
        >
          {formatter.number(row.stock)}
          {row.isLow ? (
            // The badge states WHY it's flagged, using the server's threshold —
            // a bare colour leaves the reader guessing at the rule.
            <span className="ms-2 text-xs font-normal">
              {t('lowBadge', { threshold: formatter.number(result?.threshold ?? 0) })}
            </span>
          ) : null}
        </span>
      ),
      sortValue: (row) => row.stock,
    },
    {
      id: '__actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('actions.history', { name: row.name })}
            onClick={() => setViewingLog(row.id)}
          >
            <History aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('actions.adjust', { name: row.name })}
            onClick={() => setAdjusting(row)}
          >
            <SlidersHorizontal aria-hidden />
            {t('actions.adjustShort')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="inventory-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="inventory-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <Button
          variant={lowOnly ? 'default' : 'outline'}
          aria-pressed={lowOnly}
          onClick={() => {
            setLowOnly((current) => !current);
            setPage(1);
          }}
        >
          {t('filters.lowOnly')}
        </Button>
      </div>

      {notice ? (
        // role="status": worth announcing, must not interrupt the next action.
        <p role="status" className="bg-muted rounded-md px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      <DataTable
        data={result?.products ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={
          lowOnly ? t('emptyLow') : search ? tTable('noResults') : t('empty')
        }
      />

      {result && result.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('total', { count: result.total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('pagination.previous')}
            </Button>
            <span className="text-sm tabular-nums">
              {tTable('pageOf', { page, total: result.totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= result.totalPages || isLoading}
              onClick={() =>
                setPage((current) => Math.min(result.totalPages, current + 1))
              }
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <StockAdjustSheet
        product={adjusting}
        open={adjusting !== null}
        onOpenChange={(next) => {
          if (!next) setAdjusting(null);
        }}
        onAdjusted={(message) => {
          setNotice(message);
          void load();
        }}
      />

      <MovementLogSheet
        productId={viewingLog}
        open={viewingLog !== null}
        onOpenChange={(next) => {
          if (!next) setViewingLog(null);
        }}
      />
    </div>
  );
}
