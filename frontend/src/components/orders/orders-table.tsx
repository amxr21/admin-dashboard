'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Download, Search } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { SavedViewTabs, type SavedView } from '@/components/saved-view-tabs';
import { Timestamp } from '@/components/timestamp';
import { TablePagination } from '@/components/table-pagination';
import { DensityToggle } from '@/components/density-toggle';
import { getGlobalDensity } from '@/lib/apply-appearance';
import { useTableDensity } from '@/hooks/useTableDensity';
import { StatusBadge } from '@/components/status-badge';
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
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTypedConfirm } from '@/components/danger-zone';
import {
  bulkChangeOrderStatus,
  exportOrdersCsv,
  fetchOrders,
  previewBulkStatusChange,
  type BulkStatusPreview,
  type OrderListResult,
  type OrderListRow,
  type OrderSortField,
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

/** Defaults are omitted from the URL, so an unfiltered list has a clean one. */
const URL_DEFAULTS = {
  page: '1',
  search: '',
  status: ALL,
  from: '',
  to: '',
  pageSize: '',
  sort: '',
  dir: 'asc',
};

/** Mirrors OrderSortField in orders-api.ts / orders.service.ts — the columns
 *  the backend can actually sort by. */
const SORTABLE_FIELDS: OrderSortField[] = ['orderNumber', 'placedAt', 'total', 'status'];

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
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  /** Per-table density override — see resource-table.tsx / useTableDensity.ts. */
  const { override: densityOverride, setOverride: setDensityOverride } =
    useTableDensity('orders');
  const [result, setResult] = useState<OrderListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /** The target status picked in the bulk bar, confirmed via AlertDialog
   *  before it fires — same two-step shape as a bulk delete elsewhere in the
   *  app, since this touches multiple orders' real lifecycle state at once. */
  const [bulkTarget, setBulkTarget] = useState<OrderStatus | ''>('');
  const [pendingBulk, setPendingBulk] = useState<{
    ids: string[];
    to: OrderStatus;
  } | null>(null);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  /**
   * What the move would actually do (C5.5) — fetched the moment the dialog
   * opens, so the confirmation names a real dependency count (orders with a
   * live courier assignment) and flags a terminal target, instead of a
   * generic "are you sure?". `null` while loading; the confirm button stays
   * disabled until it resolves, since committing blind to an unknown-size
   * consequence is the exact thing this exists to prevent.
   */
  const [bulkPreview, setBulkPreview] = useState<BulkStatusPreview | null>(null);
  const [bulkPreviewFailed, setBulkPreviewFailed] = useState(false);

  // A terminal target (CANCELED/RETURNED) can never be undone by another
  // status move, so it's the one case gated behind a typed phrase — same bar
  // the settings danger zone uses for its own irreversible actions. The
  // phrase is the raw English enum value, not the translated label — same
  // convention as every other typed confirmation in the app (DEACTIVATE,
  // TRANSFER, DELETE): a fixed word to type, not something that changes
  // shape per locale.
  const confirmPhrase = pendingBulk?.to ?? '';
  const typedConfirm = useTypedConfirm(confirmPhrase);

  useEffect(() => {
    if (!pendingBulk) {
      setBulkPreview(null);
      setBulkPreviewFailed(false);
      return;
    }

    let cancelled = false;
    setBulkPreview(null);
    setBulkPreviewFailed(false);

    previewBulkStatusChange(pendingBulk.ids, pendingBulk.to)
      .then((result) => {
        if (!cancelled) setBulkPreview(result);
      })
      .catch(() => {
        if (!cancelled) setBulkPreviewFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [pendingBulk]);

  /**
   * Page, search, status and the date range all live in the URL.
   *
   * `?status=` was previously read ONCE via a lazy `useState` initializer and
   * never written back, so the dashboard's Cancelled KPI deep link worked on
   * arrival and then drifted: changing the filter left the URL claiming the
   * old one. A seed-only param is worse than none, because the URL actively
   * lies about what is on screen.
   */
  const { values, setValues, clear } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);

  /** Overrides `dashboard.tablePageSize` for this view only — see resource-table.tsx. */
  const urlPageSize = Number(values.pageSize);
  const effectivePageSize =
    Number.isFinite(urlPageSize) && urlPageSize > 0 ? urlPageSize : tablePageSize;
  const search = values.search ?? '';
  const from = values.from ?? '';
  const to = values.to ?? '';

  // Validated against the known set: a hand-edited `?status=NONSENSE` would
  // otherwise be sent to the API, which rejects it with a 400 the user can do
  // nothing about. An unknown value falls back to "all".
  const rawStatus = values.status ?? ALL;
  const status: OrderStatus | typeof ALL = STATUSES.includes(rawStatus as OrderStatus)
    ? (rawStatus as OrderStatus)
    : ALL;

  // Same validated-against-the-known-set discipline as status: a hand-edited
  // `?sort=itemCount` (item count and customer are client-only sorts, not
  // server-sortable — see SORTABLE_FIELDS) degrades to "no sort" rather than
  // reaching the API, which would reject it with a 400.
  const rawSort = values.sort ?? '';
  const sortField = SORTABLE_FIELDS.includes(rawSort as OrderSortField)
    ? (rawSort as OrderSortField)
    : undefined;
  const sort: SortState | null = sortField
    ? { id: sortField, direction: values.dir === 'desc' ? 'desc' : 'asc' }
    : null;

  const handleSortChange = useCallback(
    (next: SortState | null) => {
      setValues({
        sort: next?.id ?? null,
        // Only `desc` is written — `asc` is the default, keeping the common
        // case's URL short, same convention as resource-table.tsx.
        dir: next?.direction === 'desc' ? 'desc' : null,
        page: null,
      });
    },
    [setValues],
  );

  // Holds raw keystrokes; only the debounced value reaches the URL.
  const [searchInput, setSearchInput] = useState(search);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchOrders({
          page,
          pageSize: effectivePageSize,
          ...(search ? { search } : {}),
          ...(status === ALL ? {} : { status }),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(sortField ? { sort: sortField, dir: sort?.direction } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status, from, to, sortField, sort?.direction, effectivePageSize, translateError]);

  /**
   * Exports the FILTER, not the current page — same reasoning as the audit
   * trail's own export button. Sends the identical search/status/date/sort
   * params `load` above builds, minus page/pageSize, so what downloads is
   * always "everything currently filtered to", never a stale snapshot from a
   * different set of controls.
   */
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await exportOrdersCsv({
        ...(search ? { search } : {}),
        ...(status === ALL ? {} : { status }),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(sortField ? { sort: sortField, dir: sort?.direction } : {}),
      });
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsExporting(false);
    }
  }, [search, status, from, to, sortField, sort?.direction, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Reports what the server ACTUALLY did — same discipline as
   * resource-table.tsx's `runDelete`. A selection is very likely to span
   * several different current statuses, so "some skipped" is the normal
   * outcome here, not an edge case: every skip already has a real,
   * server-validated reason (the order's own current status refused this
   * exact transition), so the toast surfaces the first one rather than a
   * generic "some failed".
   */
  async function runBulkStatusChange(ids: string[], to: OrderStatus) {
    setIsBulkApplying(true);

    try {
      const outcome = await bulkChangeOrderStatus(ids, to);

      if (outcome.succeeded.length > 0) {
        toast.success(
          t('bulkStatus.notice.succeeded', { count: outcome.succeeded.length, status: t(`status.${to}`) }),
        );
      }
      if (outcome.skipped.length > 0) {
        toast.error(
          t('bulkStatus.notice.skipped', {
            count: outcome.skipped.length,
            reason: outcome.skipped[0]?.reason ?? '',
          }),
        );
      }
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsBulkApplying(false);
      setPendingBulk(null);
      setBulkTarget('');
      setSelectedIds(new Set());
      typedConfirm.reset();
      await load();
    }
  }

  /**
   * Debounced so typing doesn't fire a request — or a navigation — per
   * keystroke. Search and page are written in ONE call: two separate writes
   * would each read the same `searchParams` snapshot, so the second would
   * clobber the first and leave the user on page 4 of a brand-new query.
   */
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;

    const timer = setTimeout(() => {
      setValues({ search: trimmed, page: null });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, setValues]);

  // Carried into the detail page's URL so Prev/Next (C5.1) can reconstruct
  // the exact same filtered, sorted list this row came from — a plain
  // `/admin/orders/${id}` link has nowhere to read that back from.
  const listQuery = {
    ...(search ? { search } : {}),
    ...(status === ALL ? {} : { status }),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(sortField ? { sort: sortField, dir: sort?.direction } : {}),
  };

  const columns: readonly Column<OrderListRow>[] = [
    {
      id: 'orderNumber',
      header: t('columns.number'),
      cell: (order) => (
        <Link
          href={{ pathname: `/admin/orders/${order.id}`, query: listQuery }}
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
      // No `sortValue`: customer is a relation field, and orders.service.ts's
      // `buildOrderBy` can only sort by a column selected directly on Order —
      // a flat Prisma `orderBy` cannot reach into a relation. Giving this
      // column a `sortValue` under CONTROLLED sort would make its header
      // clickable and fire a request whose `sort=customer` the backend
      // rejects — a dead click, not a working local fallback, since
      // `onSortChange` always drives a server refetch once the table is
      // controlled (see toggleSort in data-table.tsx).
      id: 'customer',
      header: t('columns.customer'),
      cell: (order) => order.customer?.name ?? t('guest'),
    },
    {
      id: 'placedAt',
      header: t('columns.placed'),
      cell: (order) => <Timestamp value={order.placedAt} />,
      sortValue: (order) => new Date(order.placedAt),
    },
    {
      // No `sortValue` — `itemCount` is a Prisma `_count`, not a column, and
      // buildOrderBy can't sort by it either. Same reasoning as `customer`
      // above.
      id: 'items',
      header: t('columns.items'),
      align: 'end',
      cell: (order) => formatter.number(order.itemCount),
    },
    {
      id: 'total',
      header: t('columns.total'),
      align: 'end',
      // Formatted from the string, never parsed into state.
      cell: (order) => (order.total === null ? '—' : formatCurrency(Number(order.total))),
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
    ...(from
      ? [
          {
            id: 'from',
            label: `${t('filters.from')}: ${from}`,
            onRemove: () => setValues({ from: null, page: null }),
          },
        ]
      : []),
    ...(to
      ? [
          {
            id: 'to',
            label: `${t('filters.to')}: ${to}`,
            onRemove: () => setValues({ to: null, page: null }),
          },
        ]
      : []),
  ];

  // The 5 combinations staff reach for daily. A tab IS a URL write into the
  // same `status` filter the dropdown below already reads — see
  // saved-view-tabs.tsx for why that matters.
  const views: SavedView<{ status: string }>[] = [
    { id: 'all', label: t('filters.allStatuses'), filters: { status: ALL } },
    { id: 'pending', label: t('status.PENDING'), filters: { status: 'PENDING' } },
    { id: 'shipped', label: t('status.SHIPPED'), filters: { status: 'SHIPPED' } },
    { id: 'delivered', label: t('status.DELIVERED'), filters: { status: 'DELIVERED' } },
    { id: 'canceled', label: t('status.CANCELED'), filters: { status: 'CANCELED' } },
  ];

  return (
    <div className="space-y-4">
      <AlertDialog
        open={pendingBulk !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingBulk(null);
            typedConfirm.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('bulkStatus.confirmTitle', { count: pendingBulk?.ids.length ?? 0 })}
            </AlertDialogTitle>
            {/* Names the target up front — every selected order moves to the
                SAME status, and a selection spanning several current
                statuses may see some orders skipped; the dialog says so
                rather than implying a uniform, guaranteed outcome. */}
            <AlertDialogDescription>
              {pendingBulk
                ? t('bulkStatus.confirmDescription', { status: t(`status.${pendingBulk.to}`) })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* C5.5 — the real dependency count, not a generic warning. Shown
              once the preview resolves; a failed preview degrades to no
              extra detail rather than blocking the whole dialog. */}
          {bulkPreview && bulkPreview.withActiveAssignment > 0 ? (
            <p className="bg-warning/10 text-warning-foreground rounded-md px-3 py-2 text-sm">
              {t('bulkStatus.withAssignment', { count: bulkPreview.withActiveAssignment })}
            </p>
          ) : null}
          {bulkPreview?.isTerminal ? (
            <div className="space-y-2">
              <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
                {t('bulkStatus.terminalWarning', {
                  status: pendingBulk ? t(`status.${pendingBulk.to}`) : '',
                })}
              </p>
              <Label htmlFor="bulk-status-confirm">
                {t('bulkStatus.typePhrase', { phrase: confirmPhrase })}
              </Label>
              <Input
                id="bulk-status-confirm"
                value={typedConfirm.typed}
                onChange={(event) => typedConfirm.setTyped(event.target.value)}
                autoComplete="off"
                className="force-ltr"
              />
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkApplying}>
              {t('bulkStatus.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                isBulkApplying ||
                (!bulkPreview && !bulkPreviewFailed) ||
                (bulkPreview?.isTerminal ? !typedConfirm.confirmed : false)
              }
              onClick={(event) => {
                // Stays open (and disabled) until runBulkStatusChange's own
                // finally clears pendingBulk — same pattern as the resource
                // table's delete confirmation.
                event.preventDefault();
                if (pendingBulk) void runBulkStatusChange(pendingBulk.ids, pendingBulk.to);
              }}
            >
              {isBulkApplying ? t('bulkStatus.applying') : t('bulkStatus.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SavedViewTabs
        views={views}
        currentFilters={{ status }}
        onSelect={(next) =>
          setValues({ status: next.status === ALL ? null : next.status, page: null })
        }
      />

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
              setValues({ status: value === ALL ? null : value, page: null });
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
            onChange={(value) => setValues({ from: value || null, page: null })}
          />
        </div>

        <div className="w-48 space-y-2">
          <Label htmlFor="order-to">{t('filters.to')}</Label>
          <DatePicker
            id="order-to"
            value={to}
            onChange={(value) => setValues({ to: value || null, page: null })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <FilterChips
          filters={appliedFilters}
          onClearAll={() => {
            setSearchInput('');
            clear(['search', 'status', 'from', 'to', 'page']);
          }}
        />
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isExporting || isLoading || (result?.orders.length ?? 0) === 0}
            onClick={() => void handleExport()}
          >
            <Download aria-hidden className="me-1 size-4" />
            {isExporting ? t('exporting') : t('exportCsv')}
          </Button>
          <DensityToggle
            value={densityOverride ?? getGlobalDensity()}
            onChange={setDensityOverride}
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
        density={densityOverride ?? undefined}
        sort={sort}
        onSortChange={handleSortChange}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        bulkActions={(ids) => (
          <div className="flex items-center gap-3">
            <span className="text-sm">{t('bulkStatus.selected', { count: ids.size })}</span>
            <div className="w-44 space-y-2">
              <Select
                value={bulkTarget}
                onValueChange={(value) => setBulkTarget(value as OrderStatus)}
              >
                <SelectTrigger aria-label={t('bulkStatus.label')}>
                  <SelectValue placeholder={t('bulkStatus.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {t(`status.${candidate}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={!bulkTarget}
              onClick={() => {
                if (bulkTarget) setPendingBulk({ ids: [...ids], to: bulkTarget });
              }}
            >
              {t('bulkStatus.apply')}
            </Button>
          </div>
        )}
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
    </div>
  );
}
