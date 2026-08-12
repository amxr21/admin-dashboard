'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { toast } from 'sonner';

import { CopyableId } from '@/components/copyable-id';
import { DataTable, type Column } from '@/components/data-table';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { Timestamp } from '@/components/timestamp';
import { TablePagination } from '@/components/table-pagination';
import { DensityToggle } from '@/components/density-toggle';
import { getGlobalDensity } from '@/lib/apply-appearance';
import { useTableDensity } from '@/hooks/useTableDensity';
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
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { useAppSettings } from '@/components/providers/settings-provider';
import { fetchReturns, type ReturnListResult, type ReturnListRow, type ReturnStatus } from '@/lib/returns-api';

const ALL = 'all';

const STATUSES: ReturnStatus[] = ['REQUESTED', 'APPROVED', 'REJECTED'];

/** Defaults are omitted from the URL, so an unfiltered list has a clean one. */
const URL_DEFAULTS = { page: '1', search: '', status: ALL, pageSize: '' };

export function ReturnsTable() {
  const t = useTranslations('returns');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  /** Per-table density override — see resource-table.tsx / useTableDensity.ts. */
  const { override: densityOverride, setOverride: setDensityOverride } =
    useTableDensity('returns');

  const [result, setResult] = useState<ReturnListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Page, search and status live in the URL so a filtered view is shareable. */
  const { values, setValues, clear } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);

  /** Overrides `dashboard.tablePageSize` for this view only — see resource-table.tsx. */
  const urlPageSize = Number(values.pageSize);
  const effectivePageSize =
    Number.isFinite(urlPageSize) && urlPageSize > 0 ? urlPageSize : tablePageSize;
  const search = values.search ?? '';

  // Validated against the known set: a hand-edited `?status=NONSENSE` would
  // otherwise reach the API, which rejects it with a 400 the user can't act on.
  const rawStatus = values.status ?? ALL;
  const status: ReturnStatus | typeof ALL = STATUSES.includes(rawStatus as ReturnStatus)
    ? (rawStatus as ReturnStatus)
    : ALL;

  // Holds raw keystrokes; only the debounced value reaches the URL.
  const [searchInput, setSearchInput] = useState(search);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchReturns({
          page,
          pageSize: effectivePageSize,
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
  }, [page, search, status, effectivePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Debounced so typing doesn't fire a request — or a navigation — per
   * keystroke. The equality guard matters: without it this writes the URL on
   * mount with the value it just read from the URL, which is a redundant
   * navigation on every page load.
   */
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;

    const timer = setTimeout(() => {
      setValues({ search: trimmed, page: null });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, setValues]);

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
      // Not a link (the RMA column already navigates), so it can be the
      // copyable one — pasting an order number into search is the usual next
      // step from this row.
      cell: (row) => <CopyableId value={row.order.orderNumber} />,
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
      cell: (row) => <Timestamp value={row.createdAt} />,
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
    ...(status !== ALL
      ? [
          {
            id: 'status',
            // Same key the control's own <Label> uses, so the chip and the
            // field can't drift apart.
            label: `${t('columns.status')}: ${t(`status.${status}`)}`,
            onRemove: () => setValues({ status: null, page: null }),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="return-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
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
              setValues({ status: value === ALL ? null : value, page: null });
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

      <div className="flex items-center justify-between gap-3">
        <FilterChips
          filters={appliedFilters}
          onClearAll={() => {
            setSearchInput('');
            clear(['search', 'status', 'page']);
          }}
        />
        <DensityToggle
          value={densityOverride ?? getGlobalDensity()}
          onChange={setDensityOverride}
          className="ms-auto shrink-0"
        />
      </div>

      <DataTable
        data={result?.returns ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        density={densityOverride ?? undefined}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={hasFilters ? tTable('noResults') : t('empty')}
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

      <ReturnDetailSheet
        returnId={openId}
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onChanged={(text) => {
          toast.success(text);
          void load();
        }}
      />
    </div>
  );
}
