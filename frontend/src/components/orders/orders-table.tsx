'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Search } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  fetchOrders,
  type OrderListResult,
  type OrderListRow,
  type OrderStatus,
} from '@/lib/orders-api';

/**
 * The order list.
 *
 * Search, status filter, date range and pagination all go to the SERVER. The
 * engine's table does the same for configured resources; orders needs its own
 * because it filters on a date RANGE and searches across the customer
 * relation, neither of which the generic list expresses.
 */

const ALL = 'all';

const STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELED',
  'RETURNED',
];

export function OrdersTable() {
  const t = useTranslations('orders');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  const [result, setResult] = useState<OrderListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | typeof ALL>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchOrders({
          page,
          pageSize: tablePageSize,
          ...(search ? { search } : {}),
          ...(status === ALL ? {} : { status }),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status, from, to, tablePageSize, translateError]);

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

  const columns: readonly Column<OrderListRow>[] = [
    {
      id: 'orderNumber',
      header: t('columns.number'),
      cell: (order) => (
        <Link
          href={`/admin/orders/${order.id}`}
          className="hover:text-primary font-medium underline-offset-4 hover:underline"
        >
          {/* force-ltr: an order number is a code and must not visually
              reorder inside an Arabic layout. */}
          <span className="force-ltr">{order.orderNumber}</span>
        </Link>
      ),
      sortValue: (order) => order.orderNumber,
    },
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (order) => order.customer?.name ?? t('guest'),
      sortValue: (order) => order.customer?.name ?? null,
    },
    {
      id: 'placedAt',
      header: t('columns.placed'),
      cell: (order) => formatter.dateTime(new Date(order.placedAt), 'short'),
      sortValue: (order) => new Date(order.placedAt),
    },
    {
      id: 'items',
      header: t('columns.items'),
      align: 'end',
      cell: (order) => formatter.number(order.itemCount),
      sortValue: (order) => order.itemCount,
    },
    {
      id: 'total',
      header: t('columns.total'),
      align: 'end',
      // Formatted from the string, never parsed into state.
      cell: (order) =>
        order.total === null ? '—' : formatter.number(Number(order.total), 'currency'),
      sortValue: (order) => Number(order.total ?? 0),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (order) => <StatusBadge kind="orderStatus" value={order.status} />,
      sortValue: (order) => order.status,
    },
  ];

  const hasFilters = Boolean(search) || status !== ALL || Boolean(from) || Boolean(to);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="order-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="order-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="order-status">{t('columns.status')}</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as OrderStatus | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger id="order-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`status.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-48 space-y-2">
          <Label htmlFor="order-from">{t('filters.from')}</Label>
          <DatePicker
            id="order-from"
            value={from}
            onChange={(value) => {
              setFrom(value);
              setPage(1);
            }}
          />
        </div>

        <div className="w-48 space-y-2">
          <Label htmlFor="order-to">{t('filters.to')}</Label>
          <DatePicker
            id="order-to"
            value={to}
            onChange={(value) => {
              setTo(value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <DataTable
        data={result?.orders ?? []}
        columns={columns}
        getRowId={(order) => order.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={hasFilters ? tTable('noResults') : t('empty')}
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
    </div>
  );
}
