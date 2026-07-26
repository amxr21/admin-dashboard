'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { fetchProducts, type Product, type ProductStatus } from '@/lib/products';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';

/**
 * The product catalogue list.
 *
 * ─── SERVER-SIDE EVERYTHING ──────────────────────────────────────────
 * Search, filter and pagination all go to the API rather than filtering an
 * array in the browser. A catalogue outgrows the client silently: it works
 * fine at 40 products in development and ships 4,000 rows to a phone in
 * production. DataTable's own sorting stays client-side because it only ever
 * reorders the page you can already see.
 *
 * ─── PRICE IS NEVER A NUMBER ─────────────────────────────────────────
 * The API sends a decimal string. It is formatted for display and never
 * parsed — see lib/products.ts.
 */

const ALL = 'all';
const PAGE_SIZE = 20;

export function ProductsTable() {
  const t = useTranslations('products');
  const tCounts = useTranslations('counts');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [products, setProducts] = useState<readonly Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductStatus | typeof ALL>(ALL);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchProducts({
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(status === ALL ? {} : { status }),
      });

      setProducts(result.products);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      // Distinguish WHY it failed — "something went wrong" turns a recoverable
      // expired session into what looks like a broken app.
      setError(
        caught instanceof ApiError ? translateError(caught) : translateError(null),
      );
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status, translateError]);

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

  const columns: readonly Column<Product>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      cell: (product) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{product.name}</p>
          {product.sku ? (
            // force-ltr: a SKU is a code, and must not visually reorder inside
            // an Arabic layout.
            <p className="text-muted-foreground force-ltr truncate text-xs">
              {product.sku}
            </p>
          ) : null}
        </div>
      ),
      sortValue: (product) => product.name,
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (product) => product.category?.name ?? '—',
      sortValue: (product) => product.category?.name ?? null,
    },
    {
      id: 'price',
      header: t('columns.price'),
      align: 'end',
      // Formatted from the string, never parsed into app state. Number() here
      // is display-only and never written back.
      cell: (product) => formatter.number(Number(product.price), 'currency'),
      sortValue: (product) => Number(product.price),
    },
    {
      id: 'stock',
      header: t('columns.stock'),
      align: 'end',
      cell: (product) => (
        <span className={product.stock === 0 ? 'text-destructive font-medium' : undefined}>
          {formatter.number(product.stock)}
        </span>
      ),
      sortValue: (product) => product.stock,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (product) => <StatusBadge kind="productStatus" value={product.status} />,
      sortValue: (product) => product.status,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="product-search">{t('search.label')}</Label>
          <div className="relative">
            {/* Positioned with a logical property so it moves to the right
                edge in Arabic without a second rule. */}
            <Search
              className="text-muted-foreground pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="product-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="product-status">{t('filters.status')}</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as ProductStatus | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger id="product-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
              <SelectItem value="ACTIVE">{t('status.ACTIVE')}</SelectItem>
              <SelectItem value="DRAFT">{t('status.DRAFT')}</SelectItem>
              <SelectItem value="ARCHIVED">{t('status.ARCHIVED')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        data={products}
        columns={columns}
        getRowId={(product) => product.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        emptyMessage={search || status !== ALL ? tTable('noResults') : t('empty')}
        bulkActions={(ids) => (
          <span className="text-sm">{tCounts('selected', { count: ids.size })}</span>
        )}
      />

      {/* Pagination is hidden rather than rendered disabled when there is only
          one page — a dead control is noise. */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            {tCounts('products', { count: total })}
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
              {tTable('pageOf', { page, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
