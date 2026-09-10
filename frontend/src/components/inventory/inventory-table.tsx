'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Boxes, FilterX, History, MailPlus, PackagePlus, Search, SearchX, SlidersHorizontal, Truck } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { Link, useRouter } from '@/i18n/navigation';
import { useResourceSchema } from '@/components/providers/schema-provider';
import { MovementLogSheet } from '@/components/inventory/movement-log-sheet';
import { StockAdjustSheet } from '@/components/inventory/stock-adjust-sheet';
import { SupplierOutreachSheet } from '@/components/suppliers/supplier-outreach-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
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
 *
 * ─── WHY THIS PAGE LINKS OUT TO PRODUCTS (F3.1) ──────────────────────
 * Adding stock and adding a PRODUCT are different acts, and this page could
 * only ever do the first. Someone arriving here to "add an item" previously
 * hit a dead end: no button, and nothing saying the answer lives on another
 * page under a different nav group.
 *
 * The fix is a link, never a second create form. Product creation has one
 * home — the generic resource form — and forking a private copy here would
 * mean two surfaces drifting apart on validation, required fields and
 * permissions. `canCreateProducts` comes from the SAME permission-filtered
 * schema that gates the real form, so this cannot offer an action the
 * destination would then refuse.
 */

export function InventoryTable() {
  const t = useTranslations('inventory');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();
  const searchParams = useSearchParams();
  const { resources } = useResourceSchema();
  const router = useRouter();

  // Undefined while the schema is still loading, and absent entirely for a
  // role the API filtered `products` out of — both correctly mean "don't
  // offer creation", with no optimistic flash of a button that would 403.
  const canCreateProducts =
    resources.find((resource) => resource.resource === 'products')?.permissions.create === true;

  const [result, setResult] = useState<InventoryListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Seeded from `?lowStock=true` — the dashboard's "View low stock" quick
  // action deep-links here, same lazy-initializer pattern Audit uses for its
  // own `?entity=`/`?entityId=` deep link.
  const [lowOnly, setLowOnly] = useState(() => searchParams.get('lowStock') === 'true');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  /**
   * F3.4 — receiving is its own action, not a preset buried in "Adjust".
   *
   * "Adjust stock" is the right language for a CORRECTION and the wrong
   * language for the routine case: a delivery arriving is not something
   * going wrong, and asking someone to "adjust" it every week reads as if it
   * were. Same sheet, same endpoint, same append-only movement log — a
   * different name and a preselected reason, not a second code path.
   */
  const [receiving, setReceiving] = useState<InventoryRow | null>(null);
  const [viewingLog, setViewingLog] = useState<string | null>(null);
  const [contactingSupplier, setContactingSupplier] = useState<InventoryRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchInventory({
          page,
          pageSize: tablePageSize,
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
  }, [page, search, lowOnly, tablePageSize, translateError]);

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
              {/* The threshold that applied to THIS row, not the store-wide
                  one — a product with its own alarm would otherwise show a
                  number that does not explain why it is flagged. */}
              {t('lowBadge', { threshold: formatter.number(row.effectiveThreshold) })}
            </span>
          ) : null}
        </span>
      ),
      sortValue: (row) => row.stock,
    },
    {
      id: 'cost',
      header: t('columns.cost'),
      align: 'end',
      cell: (row) =>
        row.cost === null ? (
          /**
           * F1.4b — "not tracked" is stated, not left blank.
           *
           * Profit reporting EXCLUDES uncosted lines entirely, so a product
           * nobody has priced goes silently missing from margin rather than
           * showing up wrong there. An empty cell would read as a rendering
           * gap; this reads as a thing to go and fill in.
           */
          <span className="text-muted-foreground text-xs">{t('noCost')}</span>
        ) : (
          <span className="tabular-nums">{formatCurrency(Number(row.cost))}</span>
        ),
      // Nulls sort together rather than being scattered as 0 — the point is
      // to find them, and a fake 0 would file them among the cheapest items.
      sortValue: (row) => (row.cost === null ? null : Number(row.cost)),
    },
    {
      id: '__actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.isLow ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={t('actions.emailSupplier', { name: row.name })}
              onClick={() => setContactingSupplier(row)}
            >
              <MailPlus aria-hidden />
              {t('actions.emailSupplierShort')}
            </Button>
          ) : null}
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
          {/* Receive first and visually primary — it is what happens most
              days. Adjust stays available for the correction case. */}
          <Button
            size="sm"
            aria-label={t('actions.receive', { name: row.name })}
            onClick={() => setReceiving(row)}
          >
            <PackagePlus aria-hidden />
            {t('actions.receiveShort')}
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
            setLowOnly((current) => !current);
            setPage(1);
          }}
        >
          {t('filters.lowOnly')}
        </Button>

        {/* F3.1: the missing entry point. Deliberately a link to the one
            product-creation surface, not a create form of its own — see the
            note at the top of this file. */}
        {canCreateProducts ? (
          <Button asChild>
            <Link href="/admin/r/products?new=1">
              <PackagePlus className="size-4" aria-hidden />
              {t('actions.addProduct')}
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/admin/inventory/suppliers">
            <Truck aria-hidden />
            {t('actions.suppliers')}
          </Link>
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
        /**
         * F3.3 — three genuinely different situations that used to render as
         * three interchangeable one-line strings.
         *
         * The distinction that matters: "nothing matched" must NOT offer
         * "add a product". The rows exist, a filter is hiding them, and
         * offering creation as the only way out is how someone ends up
         * creating a duplicate of a product they already have. Same rule
         * `resource-table.tsx` already follows.
         */
        emptyMessage={
          lowOnly ? (
            <EmptyState
              icon={Boxes}
              title={t('emptyLow')}
              description={t('emptyLowHint')}
              action={{
                label: t('filters.showAll'),
                onClick: () => {
                  setLowOnly(false);
                  setPage(1);
                },
                icon: FilterX,
              }}
            />
          ) : search ? (
            <EmptyState
              icon={SearchX}
              title={tTable('noResults')}
              description={t('emptySearchHint')}
              action={{
                label: t('search.clear'),
                onClick: () => {
                  setSearchInput('');
                  setSearch('');
                  setPage(1);
                },
                icon: FilterX,
              }}
            />
          ) : (
            // The only genuinely-empty case, and the only one where creating
            // a product is the right next step.
            <EmptyState
              icon={Boxes}
              title={t('empty')}
              description={
                canCreateProducts ? t('emptyHint') : t('emptyHintReadOnly')
              }
              action={
                canCreateProducts
                  ? {
                      // `EmptyState.action` is onClick-only, so this
                      // navigates via the router rather than widening a
                      // shared component (7 consumers) for one caller.
                      label: t('actions.addProduct'),
                      onClick: () => router.push('/admin/r/products?new=1'),
                      icon: PackagePlus,
                    }
                  : undefined
              }
            />
          )
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
        variant="receive"
        product={receiving}
        open={receiving !== null}
        onOpenChange={(next) => {
          if (!next) setReceiving(null);
        }}
        onAdjusted={(message) => {
          setReceiving(null);
          setNotice(message);
          void load();
        }}
      />
      <SupplierOutreachSheet
        product={contactingSupplier}
        onOpenChange={(open) => { if (!open) setContactingSupplier(null); }}
        onSent={(supplier) => {
          setNotice(t('notice.supplierEmailed', { supplier }));
        }}
      />

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
