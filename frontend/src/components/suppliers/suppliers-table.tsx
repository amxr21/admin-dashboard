'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Mail, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { SupplierSheet } from '@/components/suppliers/supplier-sheet';
import { TablePagination } from '@/components/table-pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { fetchSuppliers, updateSupplier, type Supplier } from '@/lib/suppliers-api';

const URL_DEFAULTS = { page: '1', pageSize: '', search: '', status: 'active' };

export function SuppliersTable() {
  const t = useTranslations('suppliers');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();
  const { values, setValues, clear } = useUrlState(URL_DEFAULTS);
  const page = Math.max(1, Number(values.page) || 1);
  const rawPageSize = Number(values.pageSize);
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : tablePageSize;
  const search = values.search ?? '';
  const status = values.status === 'inactive' || values.status === 'all' ? values.status : 'active';
  const [searchInput, setSearchInput] = useState(search);
  const [result, setResult] = useState<Awaited<ReturnType<typeof fetchSuppliers>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setResult(await fetchSuppliers({ page, pageSize, ...(search ? { search } : {}), ...(status === 'all' ? {} : { active: status === 'active' }) }));
    } catch (caught) { setResult(null); setError(translateError(caught)); }
    finally { setLoading(false); }
  }, [page, pageSize, search, status, translateError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const trimmed = searchInput.trim(); if (trimmed === search) return;
    const timer = setTimeout(() => setValues({ search: trimmed, page: null }), 300);
    return () => clearTimeout(timer);
  }, [search, searchInput, setValues]);

  async function toggleActive(supplier: Supplier) {
    try {
      await updateSupplier(supplier.id, { isActive: !supplier.isActive });
      toast.success(supplier.isActive ? t('notice.deactivated') : t('notice.reactivated'));
      await load();
    } catch (caught) { toast.error(translateError(caught)); }
  }

  const columns: readonly Column<Supplier>[] = [
    { id: 'name', header: t('columns.name'), cell: (row) => <div><p className="font-medium">{row.name}</p>{row.contactName ? <p className="text-muted-foreground text-xs"><bdi dir="auto">{row.contactName}</bdi></p> : null}</div>, sortValue: (row) => row.name },
    { id: 'contact', header: t('columns.contact'), cell: (row) => <div>{row.email ? <p className="force-ltr">{row.email}</p> : <span className="text-muted-foreground">{t('noEmail')}</span>}{row.phone ? <p className="text-muted-foreground force-ltr text-xs">{row.phone}</p> : null}</div> },
    { id: 'products', header: t('columns.products'), align: 'end', cell: (row) => formatter.number(row.productCount), sortValue: (row) => row.productCount },
    { id: 'receipts', header: t('columns.receipts'), align: 'end', cell: (row) => formatter.number(row.receiptCount), sortValue: (row) => row.receiptCount },
    { id: 'lastReceived', header: t('columns.lastReceived'), cell: (row) => row.lastReceivedAt ? <time dateTime={row.lastReceivedAt}>{formatter.dateTime(new Date(row.lastReceivedAt), 'short')}</time> : '—', sortValue: (row) => row.lastReceivedAt },
    { id: 'status', header: t('columns.status'), cell: (row) => <Badge variant={row.isActive ? 'success' : 'muted'}>{row.isActive ? t('active') : t('inactive')}</Badge> },
    { id: '__actions', header: <span className="sr-only">{t('columns.actions')}</span>, align: 'end', cell: (row) => <div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setEditing(row)}><Pencil aria-hidden />{t('actions.edit')}</Button><Button size="sm" variant="ghost" onClick={() => void toggleActive(row)}>{row.isActive ? t('actions.deactivate') : t('actions.reactivate')}</Button></div> },
  ];
  const filters = search ? [{ id: 'search', label: `${t('search.label')}: ${search}`, onRemove: () => { setSearchInput(''); setValues({ search: null, page: null }); } } satisfies AppliedFilter] : [];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1 space-y-2"><Label htmlFor="supplier-search">{t('search.label')}</Label><div className="relative"><Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden /><Input id="supplier-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('search.placeholder')} className="ps-9" /></div></div>
      <Button onClick={() => setCreating(true)}><Plus aria-hidden />{t('actions.create')}</Button>
    </div>
    <div className="flex flex-wrap items-center gap-3"><SegmentedControl value={status} onChange={(value) => setValues({ status: value === 'active' ? null : value, page: null })} aria-label={t('statusLabel')} className="max-w-sm" options={[{ value: 'active', label: t('active') }, { value: 'inactive', label: t('inactive') }, { value: 'all', label: t('all') }]} /><FilterChips filters={filters} onClearAll={() => { setSearchInput(''); clear(['search', 'page']); }} /></div>
    <DataTable data={result?.suppliers ?? []} columns={columns} getRowId={(row) => row.id} isLoading={loading} error={error} onRetry={() => void load()} emptyMessage={<EmptyState icon={Mail} title={t('emptyTitle')} description={t('emptyBody')} action={{ label: t('actions.create'), onClick: () => setCreating(true), icon: Plus }} />} />
    {result ? <TablePagination page={page} totalPages={result.totalPages} total={result.total} pageSize={pageSize} isLoading={loading} onPageChange={(next) => setValues({ page: String(next) })} onPageSizeChange={(next) => setValues({ pageSize: String(next), page: null })} totalLabel={t('total', { count: result.total })} /> : null}
    <SupplierSheet supplier={editing} open={creating || editing !== null} onOpenChange={(open) => { if (!open) { setCreating(false); setEditing(null); } }} onSaved={() => { toast.success(t('notice.saved')); void load(); }} />
  </div>;
}
