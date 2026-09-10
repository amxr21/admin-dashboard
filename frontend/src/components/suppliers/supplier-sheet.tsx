'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { ErrorSection } from '@/components/errors/error-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { createSupplier, updateSupplier, type Supplier } from '@/lib/suppliers-api';

export function SupplierSheet({ supplier, open, onOpenChange, onSaved }: {
  supplier: Supplier | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const t = useTranslations('suppliers.form');
  const translateError = useTranslatedApiError();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(supplier?.name ?? ''); setEmail(supplier?.email ?? '');
    setPhone(supplier?.phone ?? ''); setContactName(supplier?.contactName ?? '');
    setNote(supplier?.note ?? ''); setError(null);
  }, [open, supplier]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError(t('nameRequired')); return; }
    setSaving(true); setError(null);
    const input = {
      name: name.trim(), email: email.trim() || null, phone: phone.trim() || null,
      contactName: contactName.trim() || null, note: note.trim() || null,
    };
    try {
      if (supplier) await updateSupplier(supplier.id, input); else await createSupplier(input);
      onSaved(); onOpenChange(false);
    } catch (caught) { setError(translateError(caught)); }
    finally { setSaving(false); }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" title={supplier ? t('editTitle') : t('createTitle')} description={t('description')} className="overflow-y-auto">
        <header><h2 className="text-lg font-semibold">{supplier ? t('editTitle') : t('createTitle')}</h2><p className="text-muted-foreground text-sm">{t('description')}</p></header>
        {error ? <ErrorSection title={t('saveFailed')} description={error} /> : null}
        <form className="space-y-4" onSubmit={submit}>
          <Field id="supplier-name" label={t('name')}><Input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required /></Field>
          <Field id="supplier-email" label={t('email')}><Input id="supplier-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></Field>
          <Field id="supplier-phone" label={t('phone')}><Input id="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="force-ltr" /></Field>
          <Field id="supplier-contact" label={t('contactName')}><Input id="supplier-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={160} /></Field>
          <Field id="supplier-note" label={t('note')}><Textarea id="supplier-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('saving') : t('save')}</Button></div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
