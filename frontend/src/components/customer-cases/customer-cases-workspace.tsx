'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { MessageSquarePlus, Search } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { TablePagination } from '@/components/table-pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import {
  addCustomerCaseNote, CASE_PRIORITIES, CASE_STATUSES, createCustomerCase,
  fetchCustomerCase, fetchCustomerCases, searchCaseLinkOptions, updateCustomerCase,
  type CaseLinkOptions, type CustomerCaseDetail, type CustomerCasePriority,
  type CustomerCaseStatus, type CustomerCaseSummary,
} from '@/lib/customer-cases-api';

const ALL = 'all';
const URL_DEFAULTS = { page: '1', pageSize: '', search: '', status: ALL, priority: ALL };
const EMPTY_LINKS: CaseLinkOptions = { customers: [], orders: [], assignees: [] };

export function CustomerCasesWorkspace() {
  const t = useTranslations('customerCases');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();
  const { values, setValues } = useUrlState(URL_DEFAULTS);
  const page = Math.max(1, Number(values.page) || 1);
  const pageSize = Number(values.pageSize) || tablePageSize;
  const search = values.search ?? '';
  const status = values.status ?? ALL;
  const priority = values.priority ?? ALL;
  const [searchInput, setSearchInput] = useState(search);
  const [rows, setRows] = useState<CustomerCaseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerCaseDetail | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setIsLoading(true); setError(null);
    try {
      const result = await fetchCustomerCases({ page, pageSize, search: search || undefined, status: status === ALL ? undefined : status, priority: priority === ALL ? undefined : priority });
      if (current === requestId.current) { setRows(result.cases); setTotal(result.total); setTotalPages(result.totalPages); }
    } catch (caught) { if (current === requestId.current) setError(translateError(caught)); }
    finally { if (current === requestId.current) setIsLoading(false); }
  }, [page, pageSize, priority, search, status, translateError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = setTimeout(() => { const next = searchInput.trim(); if (next !== search) setValues({ search: next || null, page: null }); }, 300); return () => clearTimeout(timer); }, [search, searchInput, setValues]);

  async function openCase(id: string) {
    try { setSelected(await fetchCustomerCase(id)); } catch (caught) { setError(translateError(caught)); }
  }

  const columns: readonly Column<CustomerCaseSummary>[] = [
    { id: 'case', header: t('columns.case'), cell: (row) => <button className="text-start font-medium underline-offset-4 hover:underline" onClick={() => void openCase(row.id)}><span className="force-ltr block text-xs">{row.caseNumber}</span><bdi dir="auto">{row.title}</bdi></button> },
    { id: 'customer', header: t('columns.customer'), cell: (row) => row.customer ? <div><bdi dir="auto">{row.customer.name}</bdi><span className="text-muted-foreground force-ltr block text-xs">{row.customer.phone ?? row.customer.email}</span></div> : t('notLinked') },
    { id: 'order', header: t('columns.order'), cell: (row) => row.order ? <span className="force-ltr">{row.order.orderNumber}</span> : t('notLinked') },
    { id: 'status', header: t('columns.status'), cell: (row) => <Badge variant={row.status === 'OPEN' ? 'warning' : row.status === 'RESOLVED' ? 'success' : 'muted'}>{t(`status.${row.status}`)}</Badge> },
    { id: 'priority', header: t('columns.priority'), cell: (row) => <Badge variant={row.priority === 'URGENT' ? 'destructive' : row.priority === 'HIGH' ? 'warning' : 'secondary'}>{t(`priority.${row.priority}`)}</Badge> },
    { id: 'owner', header: t('columns.owner'), cell: (row) => <bdi dir="auto">{row.assignedTo?.name ?? row.assignedTo?.email ?? t('unassigned')}</bdi> },
    { id: 'updated', header: t('columns.updated'), cell: (row) => <time dateTime={row.updatedAt}>{formatter.dateTime(new Date(row.updatedAt), 'short')}</time> },
  ];

  return <section className="space-y-4" aria-label={t('title')}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="case-search">{t('search')}</Label><div className="relative"><Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden /><Input id="case-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" /></div></div>
      <div className="space-y-2 sm:w-44"><Label htmlFor="case-status">{t('columns.status')}</Label><Select value={status} onValueChange={(value) => setValues({ status: value === ALL ? null : value, page: null })}><SelectTrigger id="case-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>{t('all')}</SelectItem>{CASE_STATUSES.map((value) => <SelectItem key={value} value={value}>{t(`status.${value}`)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2 sm:w-44"><Label htmlFor="case-priority">{t('columns.priority')}</Label><Select value={priority} onValueChange={(value) => setValues({ priority: value === ALL ? null : value, page: null })}><SelectTrigger id="case-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>{t('all')}</SelectItem>{CASE_PRIORITIES.map((value) => <SelectItem key={value} value={value}>{t(`priority.${value}`)}</SelectItem>)}</SelectContent></Select></div>
      <Button onClick={() => setCreateOpen(true)}><MessageSquarePlus aria-hidden />{t('newCase')}</Button>
    </div>
    <DataTable data={rows} columns={columns} getRowId={(row) => row.id} isLoading={isLoading} error={error} onRetry={() => void load()} emptyMessage={<EmptyState title={t('emptyTitle')} description={t('emptyBody')} />} />
    <TablePagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} isLoading={isLoading} onPageChange={(next) => setValues({ page: String(next) })} onPageSizeChange={(next) => setValues({ pageSize: String(next), page: null })} />
    <CreateCaseSheet open={createOpen} onOpenChange={setCreateOpen} onCreated={() => { setCreateOpen(false); void load(); }} />
    <CaseDetailSheet item={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} onChanged={(item) => { setSelected(item); void load(); }} />
  </section>;
}

function CreateCaseSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const t = useTranslations('customerCases'); const translateError = useTranslatedApiError();
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [priority, setPriority] = useState<CustomerCasePriority>('NORMAL');
  const [linkSearch, setLinkSearch] = useState(''); const [links, setLinks] = useState(EMPTY_LINKS); const [customerId, setCustomerId] = useState<string>(); const [orderId, setOrderId] = useState<string>(); const [assignedToId, setAssignedToId] = useState<string>(); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const q = linkSearch.trim(); if (!open || q.length < 2) { setLinks(EMPTY_LINKS); return; } let active = true; const timer = setTimeout(() => searchCaseLinkOptions(q).then((result) => { if (active) setLinks(result); }).catch(() => { if (active) setLinks(EMPTY_LINKS); }), 250); return () => { active = false; clearTimeout(timer); }; }, [linkSearch, open]);
  async function submit() { setSaving(true); setError(null); try { await createCustomerCase({ title: title.trim(), description: description.trim() || undefined, priority, customerId, orderId, assignedToId }); setTitle(''); setDescription(''); setLinkSearch(''); setLinks(EMPTY_LINKS); setCustomerId(undefined); setOrderId(undefined); setAssignedToId(undefined); toast.success(t('created')); onCreated(); } catch (caught) { setError(translateError(caught)); } finally { setSaving(false); } }
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="end" title={t('newCase')} description={t('createDescription')} className="w-full max-w-lg overflow-y-auto"><div className="space-y-5"><div><h2 className="text-lg font-semibold">{t('newCase')}</h2><p className="text-muted-foreground text-sm">{t('createDescription')}</p></div><div className="space-y-2"><Label htmlFor="new-case-title">{t('form.title')}</Label><Input id="new-case-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div><div className="space-y-2"><Label htmlFor="new-case-description">{t('form.description')}</Label><Textarea id="new-case-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} /></div><div className="space-y-2"><Label htmlFor="new-case-priority">{t('columns.priority')}</Label><Select value={priority} onValueChange={(v) => setPriority(v as CustomerCasePriority)}><SelectTrigger id="new-case-priority"><SelectValue /></SelectTrigger><SelectContent>{CASE_PRIORITIES.map((v) => <SelectItem key={v} value={v}>{t(`priority.${v}`)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="case-link-search">{t('form.links')}</Label><Input id="case-link-search" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} placeholder={t('form.linksPlaceholder')} />{linkSearch.trim().length >= 2 ? <div className="space-y-2 rounded-md border p-2 text-sm"><OptionGroup title={t('form.customers')} options={links.customers.map((x) => ({ id: x.id, label: `${x.name} · ${x.phone ?? x.email}` }))} selected={customerId} onSelect={setCustomerId} /><OptionGroup title={t('form.orders')} options={links.orders.map((x) => ({ id: x.id, label: x.orderNumber }))} selected={orderId} onSelect={setOrderId} /><OptionGroup title={t('form.assignees')} options={links.assignees.map((x) => ({ id: x.id, label: x.name ?? x.email }))} selected={assignedToId} onSelect={setAssignedToId} /></div> : null}</div>{error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}<Button className="w-full" disabled={saving || !title.trim()} onClick={() => void submit()}>{saving ? t('saving') : t('create')}</Button></div></SheetContent></Sheet>;
}

function OptionGroup({ title, options, selected, onSelect }: { title: string; options: { id: string; label: string }[]; selected?: string; onSelect: (id: string | undefined) => void }) { if (!options.length) return null; return <fieldset><legend className="text-muted-foreground mb-1 text-xs font-medium">{title}</legend><div className="flex flex-wrap gap-1">{options.map((option) => <Button key={option.id} type="button" size="sm" variant={selected === option.id ? 'default' : 'outline'} onClick={() => onSelect(selected === option.id ? undefined : option.id)}><bdi dir="auto">{option.label}</bdi></Button>)}</div></fieldset>; }

function CaseDetailSheet({ item, onOpenChange, onChanged }: { item: CustomerCaseDetail | null; onOpenChange: (open: boolean) => void; onChanged: (item: CustomerCaseDetail) => void }) {
  const t = useTranslations('customerCases'); const formatter = useFormatter(); const translateError = useTranslatedApiError(); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  if (!item) return null;
  async function update(input: { status?: CustomerCaseStatus; priority?: CustomerCasePriority }) { setSaving(true); setError(null); try { onChanged(await updateCustomerCase(item!.id, input)); } catch (caught) { setError(translateError(caught)); } finally { setSaving(false); } }
  async function addNote() { if (!note.trim()) return; setSaving(true); setError(null); try { onChanged(await addCustomerCaseNote(item!.id, note.trim())); setNote(''); } catch (caught) { setError(translateError(caught)); } finally { setSaving(false); } }
  return <Sheet open onOpenChange={onOpenChange}><SheetContent side="end" title={item.title} className="w-full max-w-xl overflow-y-auto"><div className="space-y-5"><div><p className="text-muted-foreground force-ltr text-xs">{item.caseNumber}</p><h2 className="text-lg font-semibold"><bdi dir="auto">{item.title}</bdi></h2><p className="text-muted-foreground mt-1 whitespace-pre-wrap text-sm"><bdi dir="auto">{item.description || t('noDescription')}</bdi></p></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>{t('columns.status')}</Label><Select disabled={saving} value={item.status} onValueChange={(v) => void update({ status: v as CustomerCaseStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CASE_STATUSES.map((v) => <SelectItem key={v} value={v}>{t(`status.${v}`)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>{t('columns.priority')}</Label><Select disabled={saving} value={item.priority} onValueChange={(v) => void update({ priority: v as CustomerCasePriority })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CASE_PRIORITIES.map((v) => <SelectItem key={v} value={v}>{t(`priority.${v}`)}</SelectItem>)}</SelectContent></Select></div></div><dl className="grid gap-2 rounded-md border p-3 text-sm"><div><dt className="text-muted-foreground">{t('columns.customer')}</dt><dd><bdi dir="auto">{item.customer?.name ?? t('notLinked')}</bdi></dd></div><div><dt className="text-muted-foreground">{t('columns.order')}</dt><dd className="force-ltr">{item.order?.orderNumber ?? t('notLinked')}</dd></div><div><dt className="text-muted-foreground">{t('columns.owner')}</dt><dd><bdi dir="auto">{item.assignedTo?.name ?? item.assignedTo?.email ?? t('unassigned')}</bdi></dd></div></dl><div className="space-y-3"><h3 className="font-medium">{t('notes')}</h3>{item.notes.length ? <ol className="space-y-2">{item.notes.map((entry) => <li key={entry.id} className="bg-muted/40 rounded-md p-3 text-sm"><p className="whitespace-pre-wrap"><bdi dir="auto">{entry.body}</bdi></p><p className="text-muted-foreground mt-1 text-xs"><bdi dir="auto">{entry.author?.name ?? entry.author?.email ?? t('unknownAuthor')}</bdi> · <time dateTime={entry.createdAt}>{formatter.dateTime(new Date(entry.createdAt), 'short')}</time></p></li>)}</ol> : <p className="text-muted-foreground text-sm">{t('noNotes')}</p>}<Label htmlFor="new-case-note">{t('addNote')}</Label><Textarea id="new-case-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /><Button disabled={saving || !note.trim()} onClick={() => void addNote()}>{t('saveNote')}</Button></div>{error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}</div></SheetContent></Sheet>;
}
