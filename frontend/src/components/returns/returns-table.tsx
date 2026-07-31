'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { ReturnDetailSheet } from '@/components/returns/return-detail-sheet';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import { fetchReturns, type ReturnListResult, type ReturnListRow, type ReturnStatus } from '@/lib/returns-api';

const ALL = 'all';

const STATUSES: ReturnStatus[] = ['REQUESTED', 'APPROVED', 'REJECTED'];

export function ReturnsTable() {
  const t = useTranslations('returns');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  const [result, setResult] = useState<ReturnListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ReturnStatus | typeof ALL>(ALL);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchReturns({
          page,
          pageSize: tablePageSize,
          ...(search ? { search } : {}),
          ...(status === ALL ? {} : { status }),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status, tablePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const columns: readonly Column<ReturnListRow>[] = [
    {
      id: 'rmaNumber',
      header: t('columns.rma'),
      cell: (row) => (
        <button
          type="button"
          onClick={() => setOpenId(row.id)}
          className="hover:text-primary font-medium underline-offset-4 hover:underline"
        >
          <span className="force-ltr">{row.rmaNumber}</span>
        </button>
      ),
      sortValue: (row) => row.rmaNumber,
    },
    {
      id: 'order',
      header: t('columns.order'),
      cell: (row) => <span className="force-ltr">{row.order.orderNumber}</span>,
      sortValue: (row) => row.order.orderNumber,
    },
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (row) => row.customer?.name ?? '—',
      sortValue: (row) => row.customer?.name ?? null,
    },
    {
      id: 'items',
      header: t('columns.items'),
      align: 'end',
      cell: (row) => formatter.number(row.itemCount),
      sortValue: (row) => row.itemCount,
    },
    {
      id: 'createdAt',
      header: t('columns.requested'),
      cell: (row) => formatter.dateTime(new Date(row.createdAt), 'short'),
      sortValue: (row) => new Date(row.createdAt),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (row) => <StatusBadge kind="returnStatus" value={row.status} />,
      sortValue: (row) => row.status,
    },
  ];

  const hasFilters = Boolean(search) || status !== ALL;

  return (
    <div className="space-y-4">
      {message ? (
        <p role="status" className="bg-success/10 text-success rounded-md px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="return-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="return-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <div className="w-48 space-y-2">
          <Label htmlFor="return-status">{t('columns.status')}</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as ReturnStatus | typeof ALL);
              setPage(1);
            }}
          >
            <SelectTrigger id="return-status">
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
      </div>

      <DataTable
        data={result?.returns ?? []}
        columns={columns}
        getRowId={(row) => row.id}
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
              onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <ReturnDetailSheet
        returnId={openId}
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onChanged={(text) => {
          setMessage(text);
          void load();
        }}
      />
    </div>
  );
}
