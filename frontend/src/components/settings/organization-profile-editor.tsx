'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import {
  fetchOrganizationProfile,
  saveOrganizationProfile,
  type CustomValue,
  type OrganizationData,
  type OrganizationEntity,
  type OrganizationField,
  type OrganizationProfile,
} from '@/lib/organization-api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ErrorSection } from '@/components/errors/error-section';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/loading-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface OrganizationProfileEditorProps {
  entityType: OrganizationEntity;
  entityId: string;
  fields: OrganizationField[];
  staff: OrganizationData['entities']['staff'];
  onSaved: () => void;
}

function dateValue(value: CustomValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function OrganizationProfileEditor({ entityType, entityId, fields, staff, onSaved }: OrganizationProfileEditorProps) {
  const t = useTranslations('organization');
  const common = useTranslations('common');
  const translateError = useTranslatedApiError();
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetchOrganizationProfile(entityType, entityId)
      .then(next => { if (!cancelled) setProfile(next); })
      .catch(caught => { if (!cancelled) setError(translateError(caught)); });
    return () => { cancelled = true; };
  }, [entityType, entityId, attempt, translateError]);

  if (!profile) {
    return error
      ? <ErrorSection title={t('profiles')} description={error} onRetry={() => setAttempt(value => value + 1)} />
      : <LoadingState />;
  }

  const activeFields = fields.filter(field => field.isActive);
  function setValue(id: string, value: CustomValue) {
    setProfile(current => current ? { ...current, values: { ...current.values, [id]: value } } : current);
  }

  async function submit() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const values = Object.fromEntries(
        activeFields
          .filter(field => profile.values[field.id] !== undefined)
          .map(field => [field.id, profile.values[field.id] ?? null]),
      );
      await saveOrganizationProfile({ ...profile, values });
      toast.success(common('savedNotice'));
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status < 500 ? caught.message : translateError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="bg-card space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <Link className="text-primary text-sm underline" href={entityType === 'business' ? `/admin/branches/${entityId}` : entityType === 'staff' ? '/admin/staff' : '/admin/branches'}>{t('editCoreDetails')}</Link>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
        {entityType === 'staff' ? <>
          <div className="space-y-1"><Label htmlFor="profile-job-title">{t('jobTitle')}</Label><Input id="profile-job-title" maxLength={120} value={profile.jobTitle ?? ''} onChange={event => setProfile({ ...profile, jobTitle: event.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="profile-department">{t('department')}</Label><Input id="profile-department" maxLength={120} value={profile.department ?? ''} onChange={event => setProfile({ ...profile, department: event.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="profile-manager">{t('reportsTo')}</Label><Select value={profile.managerId ?? 'none'} onValueChange={value => setProfile({ ...profile, managerId: value === 'none' ? null : value })}><SelectTrigger id="profile-manager"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t('noManager')}</SelectItem>{staff.filter(person => person.id !== entityId && (person.isActive || person.id === profile.managerId)).map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>
        </> : null}
        {activeFields.map(field => <div key={field.id} className="space-y-1">
          <Label htmlFor={`profile-${field.id}`}>{field.label}{field.required ? ' *' : ''}</Label>
          {field.type === 'boolean'
            ? <Select value={typeof profile.values[field.id] === 'boolean' ? String(profile.values[field.id]) : 'unset'} onValueChange={value => setValue(field.id, value === 'unset' ? null : value === 'true')}><SelectTrigger id={`profile-${field.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unset">{t('notSet')}</SelectItem><SelectItem value="true">{t('yes')}</SelectItem><SelectItem value="false">{t('no')}</SelectItem></SelectContent></Select>
            : field.type === 'date'
              ? <DatePicker id={`profile-${field.id}`} value={dateValue(profile.values[field.id])} onChange={value => setValue(field.id, value || null)} required={field.required} />
              : <Input id={`profile-${field.id}`} type={field.type} required={field.required} maxLength={2000} step={field.type === 'number' ? 'any' : undefined} value={String(profile.values[field.id] ?? '')} onChange={event => setValue(field.id, field.type === 'number' ? event.target.value === '' ? null : Number(event.target.value) : event.target.value)} />}
        </div>)}
      </fieldset>
      {!activeFields.length ? <p className="text-muted-foreground text-sm">{t('noFields')}</p> : null}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={saving}>{saving ? common('saving') : common('save')}</Button>
    </form>
  );
}
