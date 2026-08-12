'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useUrlState } from '@/hooks/useUrlState';
import { History, Search, SlidersHorizontal } from 'lucide-react';

import { CopyableId } from '@/components/copyable-id';
import { DataTable, type Column } from '@/components/data-table';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { TablePagination } from '@/components/table-pagination';
import { DensityToggle } from '@/components/density-toggle';
import { getGlobalDensity } from '@/lib/apply-appearance';
import { useTableDensity } from '@/hooks/useTableDensity';
import { MovementLogSheet } from '@/components/inventory/movement-log-sheet';
import { StockAdjustSheet } from '@/components/inventory/stock-adjust-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
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

/** Defaults are omitted from the URL, so an unfiltered list has a clean one. */
const URL_DEFAULTS = { page: '1', search: '', lowStock: '', pageSize: '' };

export function InventoryTable() {
  const t = useTranslations('inventory');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  /** Per-table density override — see resource-table.tsx / useTableDensity.ts. */
  const { override: densityOverride, setOverride: setDensityOverride } =
    useTableDensity('inventory');

  const [result, setResult] = useState<InventoryListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Page, search and the low-stock toggle live in the URL.
   *
   * `?lowStock=true` (the dashboard's "View low stock" quick action) was
   * previously read once into `useState` and never written back, so toggling
   * the filter left the URL claiming the opposite of what was on screen.
   */
  const { values, setValues } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);

  /** Overrides `dashboard.tablePageSize` for this view only — see resource-table.tsx. */
  const urlPageSize = Number(values.pageSize);
  const effectivePageSize =
    Number.isFinite(urlPageSize) && urlPageSize > 0 ? urlPageSize : tablePageSize;
  const search = values.search ?? '';
  const lowOnly = values.lowStock === 'true';

  // Holds raw keystrokes; only the debounced value reaches the URL.
  const [searchInput, setSearchInput] = useState(search);
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
          pageSize: effectivePageSize,
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
  }, [page, search, lowOnly, effectivePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Debounced so typing doesn't fire a request — or a navigation — per
   * keystroke. Search and page go in ONE write, so a new query can't leave
   * the user stranded on a page number from the previous one.
   */
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;

    const timer = setTimeout(() => {
      setValues({ search: trimmed, page: null });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, setValues]);

  /** Built from the same values the query uses, so a chip can never claim a
   *  filter that isn't actually applied. */
  const appliedFilters: AppliedFilter[] = [
    ...(search
      ? [
          {
            id: 'search',
            label: `${t('search.label')}: ${search}`,
            onRemove: () => {
              setSearchInput('');
              setValues({ search: null, page: null });
            },
          },
        ]
      : []),
    ...(lowOnly
      ? [
          {
            id: 'lowStock',
            label: t('filters.lowOnly'),
            onRemove: () => setValues({ lowStock: null, page: null }),
          },
        ]
      : []),
  ];

  const columns: readonly Column<InventoryRow>[] = [
    {
      id: 'name',
      header: t('columns.product'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.sku ? (
            // A SKU is the value most often pasted into a supplier email or a
            // stock count sheet.
            <CopyableId value={row.sku} className="text-muted-foreground" />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('actions.history', { name: row.name })}
                onClick={() => setViewingLog(row.id)}
              >
                <History aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('actions.history', { name: row.name })}</TooltipContent>
          </Tooltip>
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
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
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
            setValues({ lowStock: lowOnly ? null : 'true', page: null });
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

      <div className="flex items-center justify-between gap-3">
        <FilterChips
          filters={appliedFilters}
          onClearAll={() => {
            setSearchInput('');
            setValues({ search: null, lowStock: null, page: null });
          }}
        />
        <DensityToggle
          value={densityOverride ?? getGlobalDensity()}
          onChange={setDensityOverride}
          className="ms-auto shrink-0"
        />
      </div>

      <DataTable
        data={result?.products ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        density={densityOverride ?? undefined}
        emptyMessage={
          lowOnly ? t('emptyLow') : search ? tTable('noResults') : t('empty')
        }
      />

      {result ? (
        <TablePagination
          page={page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={effectivePageSize}
          isLoading={isLoading}
          onPageChange={(next) => setValues({ page: String(next) })}
          onPageSizeChange={(next) => setValues({ pageSize: String(next), page: null })}
          totalLabel={t('total', { count: result.total })}
        />
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
