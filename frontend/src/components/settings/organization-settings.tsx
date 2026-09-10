'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { ApiError } from '@/lib/api';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorSection } from '@/components/errors/error-section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { OrganizationFieldEditor } from '@/components/settings/organization-field-editor';
import { OrganizationProfileEditor } from '@/components/settings/organization-profile-editor';
import {
  fetchOrganization,
  type OrganizationData, type OrganizationEntity,
} from '@/lib/organization-api';

const ENTITY_TYPES: OrganizationEntity[] = ['business', 'branch', 'staff'];

export function OrganizationSettings() {
  const t = useTranslations('organization');
  const common = useTranslations('common');
  const { user } = useAuth();
  const allowed = user?.role === 'OWNER' || user?.role === 'DEVELOPER';
  const translateError = useTranslatedApiError();
  const [data, setData] = useState<OrganizationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [entityType, setEntityType] = useState<OrganizationEntity>('business');
  const [entityId, setEntityId] = useState('');
  const [panel, setPanel] = useState('profiles');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const showError = useCallback((caught: unknown) => {
    setError(caught instanceof ApiError && (caught.status === 400 || caught.status === 409) ? caught.message : translateError(caught));
  }, [translateError]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setError(null);
    void fetchOrganization().then(next => { if (!cancelled) setData(next); })
      .catch(caught => { if (!cancelled) showError(caught); });
    return () => { cancelled = true; };
  }, [allowed, revision, showError]);

  if (!allowed) return <p role="alert">{t('ownerOnly')}</p>;
  if (!data) return error
    ? <ErrorSection title={t('title')} description={error} onRetry={refresh} />
    : <LoadingState />;
  const fields = data.fields.filter(field => field.entityType === entityType);

  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-muted-foreground mt-1">{t('description')}</p></header>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      <div className="max-w-sm space-y-2">
        <Label htmlFor="organization-type">{t('profileType')}</Label>
        <Select value={entityType} onValueChange={value => {
          const type = ENTITY_TYPES.find(type => type === value);
          if (type) { setEntityType(type); setEntityId(''); setError(null); }
        }}>
          <SelectTrigger id="organization-type"><SelectValue /></SelectTrigger>
          <SelectContent>{ENTITY_TYPES.map(type => <SelectItem key={type} value={type}>{t(`entities.${type}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-4">
        <SegmentedControl aria-label={t('title')} value={panel} onChange={setPanel} options={[{ value: 'profiles', label: t('profiles') }, { value: 'fields', label: t('customFields') }]} />
        {panel === 'profiles' ? <div className="space-y-5">
          <div className="max-w-lg space-y-2">
            <Label htmlFor="organization-record">{t('chooseRecord')}</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger id="organization-record"><SelectValue placeholder={t('chooseRecord')} /></SelectTrigger>
              <SelectContent>{data.entities[entityType].map(entity => <SelectItem key={entity.id} value={entity.id}>{entity.name}{entity.isActive ? '' : ` (${t('inactive')})`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {data.entities[entityType].length === 0 ? <p>{t('noRecords')} <Link className="text-primary underline" href={entityType === 'staff' ? '/admin/staff' : '/admin/branches'}>{t('manageRecords')}</Link></p> : null}
          {entityId ? <OrganizationProfileEditor key={`${entityType}:${entityId}:${revision}`} entityType={entityType} entityId={entityId} fields={fields} staff={data.entities.staff} onSaved={refresh} /> : <p className="text-muted-foreground">{t('selectHint')}</p>}
          {entityType === 'staff' ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">{t('reportingLines')}</h2>
              <p className="text-muted-foreground text-sm">{t('permissionsHint')}</p>
              <ul className="divide-y rounded-lg border">
                {data.entities.staff.map(person => {
                  const profile = data.staffProfiles.find(profile => profile.entityId === person.id);
                  const manager = data.entities.staff.find(staff => staff.id === profile?.managerId);
                  return <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div><p className="font-medium">{person.name}</p><p className="text-muted-foreground text-sm">{[profile?.jobTitle, profile?.department].filter(Boolean).join(' · ') || t('noPosition')}{manager ? ` · ${t('reportsTo')}: ${manager.name}` : ''}</p></div>
                    <Button variant="outline" size="sm" onClick={() => setEntityId(person.id)}>{common('edit')}</Button>
                  </li>;
                })}
              </ul>
            </section>
          ) : null}
        </div> : <div className="space-y-5">
          <p className="text-muted-foreground text-sm">{t('fieldsHint')}</p>
          <OrganizationFieldEditor key={`new:${entityType}`} entityType={entityType} onSaved={refresh} />
          {fields.map(field => <OrganizationFieldEditor key={`${field.id}:${revision}`} entityType={entityType} field={field} onSaved={refresh} />)}
        </div>}
      </div>
    </div>
  );
}
