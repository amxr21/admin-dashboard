'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { ErrorSection } from '@/components/errors/error-section';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PhoneField } from '@/components/ui/phone-field';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { createSupplier, updateSupplier, type Supplier } from '@/lib/suppliers-api';

export function SupplierSheet({ supplier, open, onOpenChange, onSaved }: {
  supplier: Supplier | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const t = useTranslations('suppliers.form');
  // URG-013 — shared format-example placeholders (see resource-form.tsx's
  // placeholderFor).
  const tCommon = useTranslations('common');
  const translateError = useTranslatedApiError();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** The missing-name refusal, attached to the field that caused it rather
   *  than to the banner at the top — see the note on `nameError` below. */
  const [nameError, setNameError] = useState<string | null>(null);
  /** Hoisted out of PhoneField so both messages share one slot. */
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(supplier?.name ?? ''); setEmail(supplier?.email ?? '');
    setPhone(supplier?.phone ?? ''); setContactName(supplier?.contactName ?? '');
    setNote(supplier?.note ?? ''); setError(null);
    setNameError(null); setPhoneError(null);
  }, [open, supplier]);

  /**
   * Compared against the same expressions the effect above seeds from, so
   * "dirty" means exactly "differs from what this sheet opened with" — no
   * second copy of the initial values to fall out of step with the first.
   */
  const isDirty =
    open &&
    (name !== (supplier?.name ?? '') ||
      email !== (supplier?.email ?? '') ||
      phone !== (supplier?.phone ?? '') ||
      contactName !== (supplier?.contactName ?? '') ||
      note !== (supplier?.note ?? ''));

  useUnsavedChangesGuard(isDirty && !saving);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // On the FIELD, not in the banner: "Name is required" above a form of five
    // inputs makes the reader work out which one, when the answer is already
    // known at the point of the check.
    if (!name.trim()) { setNameError(t('nameRequired')); return; }
    setSaving(true); setError(null); setNameError(null);
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
          <Field id="supplier-name" label={t('name')} required error={nameError ?? undefined}>
            <Input
              id="supplier-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(null); }}
              maxLength={160}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'supplier-name-error' : undefined}
            />
          </Field>
          <Field id="supplier-email" label={t('email')}><Input id="supplier-email" type="email" placeholder={tCommon('placeholders.email')} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></Field>
          {/* URG-020/022 — PhoneField carries force-ltr and the example
              placeholder itself, so both are dropped from the call site.
              `onError` hoists its validation message into the Field's one
              slot, so a phone error and a form error can never stack. */}
          <Field id="supplier-phone" label={t('phone')} error={phoneError ?? undefined}>
            <PhoneField
              id="supplier-phone"
              value={phone}
              onChange={setPhone}
              country={null}
              maxLength={40}
              onError={setPhoneError}
            />
          </Field>
          <Field id="supplier-contact" label={t('contactName')}><Input id="supplier-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={160} /></Field>
          <Field id="supplier-note" label={t('note')}><Textarea id="supplier-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('saving') : t('save')}</Button></div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

