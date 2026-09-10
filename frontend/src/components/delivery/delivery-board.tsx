'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { History, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';

import { DataTable, type Column } from '@/components/data-table';
import { DeliveryTimelineSheet } from '@/components/delivery/delivery-timeline-sheet';
import { DensityToggle } from '@/components/density-toggle';
import { EmptyState } from '@/components/empty-state';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { StatusBadge } from '@/components/status-badge';
import { TablePagination } from '@/components/table-pagination';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBranchColumn } from '@/hooks/useBranchColumn';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTableDensity } from '@/hooks/useTableDensity';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { getGlobalDensity } from '@/lib/apply-appearance';
import { toLocalCalendarDate } from '@/lib/calendar-date';
import {
  ACTIVE_DELIVERY_STATUSES,
  DELIVERY_STATUSES,
  fetchCouriers,
  fetchDeliveryBoard,
  type Courier,
  type DeliveryBoardAssignment,
  type DeliveryBoardResult,
  type DeliveryQueue,
  type DeliveryStatus,
} from '@/lib/delivery-api';

const ALL = 'all';
const URL_DEFAULTS = {
  page: '1', pageSize: '', search: '', status: ALL, courier: ALL,
  queue: 'active', from: '', to: '',
};

/** Assignment-centred dispatch and exception review, separate from courier setup. */
export function DeliveryBoard() {
  const t = useTranslations('delivery.board');
  const tStatus = useTranslations('deliveryStatus');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();
  const translateError = useTranslatedApiError();
  const showBranch = useBranchColumn();
  const { tablePageSize } = useAppSettings();
  const { override, setOverride } = useTableDensity('delivery-board');
  const { values, setValues, clear } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);
  const rawPageSize = Number(values.pageSize);
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : tablePageSize;
  const search = values.search ?? '';
  const status = values.status ?? ALL;
  const courier = values.courier ?? ALL;
  const queue: DeliveryQueue = values.queue === 'failed' || values.queue === 'all' ? values.queue : 'active';
  const from = values.from ?? '';
  const to = values.to ?? '';
  const invalidRange = Boolean(from && to && from > to);

  const [searchInput, setSearchInput] = useState(search);
  const [result, setResult] = useState<DeliveryBoardResult | null>(null);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timelineFor, setTimelineFor] = useState<DeliveryBoardAssignment | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (invalidRange) {
      setResult(null);
      setError(t('invalidRange'));
      setIsLoading(false);
      return;
    }
    const current = ++requestId.current;
    setIsLoading(true);
    setError(null);
    try {
      const next = await fetchDeliveryBoard({
        page, pageSize, queue,
        ...(search ? { search } : {}),
        ...(status !== ALL ? { status: status as DeliveryStatus } : {}),
        ...(courier !== ALL ? { driverId: courier } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      if (requestId.current === current) setResult(next);
    } catch (caught) {
      if (requestId.current === current) {
        setResult(null);
        setError(translateError(caught));
      }
    } finally {
      if (requestId.current === current) setIsLoading(false);
    }
  }, [courier, from, invalidRange, page, pageSize, queue, search, status, t, to, translateError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetchCouriers({ pageSize: 100 }).then((data) => setCouriers(data.couriers)).catch(() => setCouriers([]));
  }, []);
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const timer = setTimeout(() => setValues({ search: trimmed, page: null }), 300);
    return () => clearTimeout(timer);
  }, [search, searchInput, setValues]);

  const count = (value: DeliveryStatus) => result?.counts[value] ?? 0;
  const activeCount = ACTIVE_DELIVERY_STATUSES.reduce((sum, value) => sum + count(value), 0);
  const allCount = result ? Object.values(result.counts).reduce((sum, value) => sum + value, 0) : 0;

  const columns: readonly Column<DeliveryBoardAssignment>[] = [
    {
      id: 'order', header: t('columns.order'),
      cell: (row) => <Link href={`/admin/orders/${row.order.id}`} className="force-ltr font-medium underline-offset-4 hover:underline">{row.order.orderNumber}</Link>,
      sortValue: (row) => row.order.orderNumber,
    },
    {
      id: 'customer', header: t('columns.customer'),
      cell: (row) => <div className="min-w-36"><bdi dir="auto">{row.customerName ?? t('notRecorded')}</bdi>{row.customerPhone ? <p className="text-muted-foreground force-ltr text-xs">{row.customerPhone}</p> : null}</div>,
    },
    {
      id: 'address', header: t('columns.address'),
      cell: (row) => <bdi dir="auto">{[row.address, row.city].filter(Boolean).join(', ') || t('notRecorded')}</bdi>,
    },
    {
      id: 'courier', header: t('columns.courier'),
      cell: (row) => <Link href={`/admin/delivery/${row.driver.id}`} className="font-medium underline-offset-4 hover:underline">{row.driver.name}</Link>,
      sortValue: (row) => row.driver.name,
    },
    ...(showBranch ? [{
      id: 'branch', header: t('columns.branch'),
      cell: (row: DeliveryBoardAssignment) => row.order.branch?.name ?? t('notRecorded'),
    }] : []),
    {
      id: 'status', header: t('columns.status'),
      cell: (row) => <StatusBadge kind="deliveryStatus" value={row.status} />,
      sortValue: (row) => row.status,
    },
    {
      id: 'amount', header: t('columns.amount'), align: 'end',
      cell: (row) => <span className="tabular-nums">{row.total === null ? '—' : formatCurrency(Number(row.total))}</span>,
      sortValue: (row) => Number(row.total ?? 0),
    },
    {
      id: 'updated', header: t('columns.updated'),
      cell: (row) => <time className="whitespace-nowrap" dateTime={row.updatedAt}>{formatter.dateTime(new Date(row.updatedAt), 'short')}</time>,
      sortValue: (row) => row.updatedAt,
    },
    {
      id: '__actions', header: <span className="sr-only">{t('columns.actions')}</span>, align: 'end',
      cell: (row) => <Button variant="outline" size="sm" onClick={() => setTimelineFor(row)}><History aria-hidden />{t('timeline')}</Button>,
    },
  ];

  const courierLabel = couriers.find((item) => item.id === courier)?.name ?? courier;
  const filters = [
    search ? { id: 'search', label: `${t('search.label')}: ${search}`, onRemove: () => { setSearchInput(''); setValues({ search: null, page: null }); } } : null,
    status !== ALL ? { id: 'status', label: `${t('filters.status')}: ${tStatus(status)}`, onRemove: () => setValues({ status: null, queue: null, page: null }) } : null,
    courier !== ALL ? { id: 'courier', label: `${t('filters.courier')}: ${courierLabel}`, onRemove: () => setValues({ courier: null, page: null }) } : null,
    from ? { id: 'from', label: `${t('filters.from')}: ${from}`, onRemove: () => setValues({ from: null, page: null }) } : null,
    to ? { id: 'to', label: `${t('filters.to')}: ${to}`, onRemove: () => setValues({ to: null, page: null }) } : null,
  ].filter((filter): filter is AppliedFilter => filter !== null);

  return (
    <section className="space-y-4" aria-labelledby="delivery-board-title">
      <div><h2 id="delivery-board-title" className="text-lg font-semibold">{t('title')}</h2><p className="text-muted-foreground text-sm">{t('subtitle')}</p></div>
      <SegmentedControl
        value={queue}
        onChange={(value) => setValues({ queue: value === 'active' ? null : value, status: null, page: null })}
        aria-label={t('queueLabel')}
        className="max-w-xl"
        options={[
          { value: 'active', label: t('queues.active', { count: activeCount }) },
          { value: 'failed', label: t('queues.failed', { count: count('FAILED_ATTEMPT') }) },
          { value: 'all', label: t('queues.all', { count: allCount }) },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-2 sm:col-span-2 xl:col-span-1"><Label htmlFor="delivery-search">{t('search.label')}</Label><div className="relative"><Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden /><Input id="delivery-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('search.placeholder')} className="ps-9" /></div></div>
        <div className="space-y-2"><Label htmlFor="delivery-courier">{t('filters.courier')}</Label><Select value={courier} onValueChange={(value) => setValues({ courier: value === ALL ? null : value, page: null })}><SelectTrigger id="delivery-courier"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>{t('filters.allCouriers')}</SelectItem>{couriers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="delivery-status">{t('filters.status')}</Label><Select value={status} onValueChange={(value) => setValues({ status: value === ALL ? null : value, queue: value === ALL ? null : 'all', page: null })}><SelectTrigger id="delivery-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>{DELIVERY_STATUSES.map((value) => <SelectItem key={value} value={value}>{tStatus(value)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="delivery-from">{t('filters.from')}</Label><DatePicker id="delivery-from" value={from} onChange={(value) => setValues({ from: value || null, page: null })} aria-invalid={invalidRange || undefined} /></div>
        <div className="space-y-2"><Label htmlFor="delivery-to">{t('filters.to')}</Label><DatePicker id="delivery-to" value={to} onChange={(value) => setValues({ to: value || null, page: null })} aria-invalid={invalidRange || undefined} /></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => { const today = toLocalCalendarDate(new Date()); setValues({ from: today, to: today, page: null }); }}>{t('today')}</Button>
        <FilterChips filters={filters} onClearAll={() => { setSearchInput(''); clear(['search', 'status', 'courier', 'queue', 'from', 'to', 'page']); }} className="min-w-0 flex-1" />
        <DensityToggle value={override ?? getGlobalDensity()} onChange={setOverride} className="ms-auto shrink-0" />
      </div>

      <DataTable data={result?.assignments ?? []} columns={columns} getRowId={(row) => row.id} isLoading={isLoading} error={error} onRetry={() => void load()} density={override ?? undefined} emptyMessage={<EmptyState title={t('emptyTitle')} description={t('emptyBody')} />} />
      {result ? <TablePagination page={page} totalPages={result.totalPages} total={result.total} pageSize={pageSize} isLoading={isLoading} onPageChange={(next) => setValues({ page: String(next) })} onPageSizeChange={(next) => setValues({ pageSize: String(next), page: null })} totalLabel={t('total', { count: result.total })} /> : null}
      <DeliveryTimelineSheet assignment={timelineFor} onOpenChange={(open) => { if (!open) setTimelineFor(null); }} />
    </section>
  );
}
