'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api';
import {
  createOrganizationField,
  updateOrganizationField,
  type OrganizationEntity,
  type OrganizationField,
} from '@/lib/organization-api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const FIELD_TYPES: OrganizationField['type'][] = ['text', 'number', 'date', 'boolean'];

interface OrganizationFieldEditorProps {
  entityType: OrganizationEntity;
  field?: OrganizationField;
  onSaved: () => void;
}

export function OrganizationFieldEditor({ entityType, field, onSaved }: OrganizationFieldEditorProps) {
  const t = useTranslations('organization');
  const common = useTranslations('common');
  const translateError = useTranslatedApiError();
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<OrganizationField['type']>(field?.type ?? 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [isActive, setActive] = useState(field?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = field?.id ?? 'new-field';

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (field) await updateOrganizationField(field.id, { label, required, isActive });
      else await createOrganizationField({ entityType, label, type, required });
      setLabel('');
      toast.success(common('savedNotice'));
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status < 500 ? caught.message : translateError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="bg-card space-y-3 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="font-medium">{field ? field.label : t('addField')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-label`}>{t('fieldLabel')}</Label>
            <Input id={`${id}-label`} required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-type`}>{t('fieldType')}</Label>
            <Select value={type} disabled={Boolean(field)} onValueChange={value => {
              const next = FIELD_TYPES.find(fieldType => fieldType === value);
              if (next) setType(next);
            }}>
              <SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map(fieldType => <SelectItem key={fieldType} value={fieldType}>{t(`types.${fieldType}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-5">
          <Label className="flex items-center gap-2"><Checkbox checked={required} onCheckedChange={value => setRequired(value === true)} />{t('required')}</Label>
          {field ? <Label className="flex items-center gap-2"><Checkbox checked={isActive} onCheckedChange={value => setActive(value === true)} />{t('activeField')}</Label> : null}
        </div>
        {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
        <Button type="submit" disabled={saving || !label.trim()}>{saving ? common('saving') : field ? common('save') : t('addField')}</Button>
      </fieldset>
    </form>
  );
}
