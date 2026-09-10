'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { ErrorSection } from '@/components/errors/error-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import type { InventoryRow } from '@/lib/inventory-api';
import { fetchProductSuppliers, sendSupplierOutreach, type ProductSupplier } from '@/lib/suppliers-api';

export function SupplierOutreachSheet({ product, onOpenChange, onSent }: {
  product: InventoryRow | null; onOpenChange: (open: boolean) => void; onSent: (supplier: string) => void;
}) {
  const t = useTranslations('suppliers.outreach');
  const translateError = useTranslatedApiError();
  const [suppliers, setSuppliers] = useState<ProductSupplier[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!product) { setSuppliers(null); return; }
    let cancelled = false;
    setSuppliers(null); setError(null);
    setSubject(t('defaultSubject', { product: product.name }));
    setMessage(t('defaultMessage', { product: product.name, stock: product.stock }));
    fetchProductSuppliers(product.id).then((result) => {
      if (cancelled) return;
      setSuppliers(result.suppliers);
      const first = result.suppliers.find((supplier) => supplier.isActive && supplier.email);
      setSupplierId(first?.id ?? '');
    }).catch((caught) => { if (!cancelled) setError(translateError(caught)); });
    return () => { cancelled = true; };
  }, [product, t, translateError]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product || !supplierId) return;
    setSending(true); setError(null);
    try {
      const result = await sendSupplierOutreach(product.id, { supplierId, subject, message });
      onSent(result.supplier.name); onOpenChange(false);
    } catch (caught) { setError(translateError(caught)); }
    finally { setSending(false); }
  }

  const eligible = suppliers?.filter((supplier) => supplier.isActive && supplier.email) ?? [];
  return <Sheet open={product !== null} onOpenChange={onOpenChange}><SheetContent side="end" title={t('title', { product: product?.name ?? '' })} description={t('description')} className="overflow-y-auto">
    <header><h2 className="text-lg font-semibold">{t('title', { product: product?.name ?? '' })}</h2><p className="text-muted-foreground text-sm">{t('description')}</p></header>
    {error ? <ErrorSection title={t('sendFailed')} description={error} /> : null}
    {suppliers === null && !error ? <div className="space-y-3" aria-label={t('loading')}><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-28 w-full" /></div> : null}
    {suppliers !== null && eligible.length === 0 ? <div className="rounded-lg border p-4"><p className="font-medium">{suppliers.length === 0 ? t('noHistoryTitle') : t('noEmailTitle')}</p><p className="text-muted-foreground mt-1 text-sm">{suppliers.length === 0 ? t('noHistoryBody') : t('noEmailBody')}</p></div> : null}
    {eligible.length > 0 ? <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2"><Label htmlFor="outreach-supplier">{t('supplier')}</Label><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger id="outreach-supplier"><SelectValue /></SelectTrigger><SelectContent>{eligible.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name} — {supplier.email}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="outreach-subject">{t('subject')}</Label><Input id="outreach-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} required /></div>
      <div className="space-y-2"><Label htmlFor="outreach-message">{t('message')}</Label><Textarea id="outreach-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} required className="min-h-40" /></div>
      <p className="text-muted-foreground text-xs">{t('editableHint')}</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button><Button type="submit" disabled={sending || !supplierId}>{sending ? t('sending') : t('send')}</Button></div>
    </form> : null}
  </SheetContent></Sheet>;
}
