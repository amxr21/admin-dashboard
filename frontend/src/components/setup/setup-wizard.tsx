'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AREAS, type Area, type StaffRole } from '@/config/areas';
import { applySetup, fetchSetup, previewSetup, skipSetup, type SetupDraft, type SetupPreview, type SetupState, type SetupValue } from '@/lib/setup-api';

const STEPS = ['entry', 'business', 'features', 'names', 'products', 'people', 'operations', 'review'] as const;
/**
 * Joins a list with the locale's own separator and conjunction. A hardcoded
 * separator is wrong in one locale by construction — Arabic uses `،` where
 * English uses `,` plus "and" — so the runtime decides, not the source.
 */
function listFormat(locale: string, items: string[]): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}
const LABEL_KEYS = ['products', 'orders', 'staff', 'inventory', 'delivery', 'returns', 'reports'];
export function SetupWizard() {
  const { user } = useAuth();
  const t = useTranslations('setup');
  if (user?.role !== 'OWNER' && user?.role !== 'DEVELOPER') return <p role="alert">{t('ownerOnly')}</p>;
  return <OwnerSetupWizard />;
}

function OwnerSetupWizard() {
  const t = useTranslations('setup');
  const locale = useLocale();
  const tTypes = useTranslations('businessTypes');
  const tNav = useTranslations('nav');
  const translateError = useTranslatedApiError();
  const { refresh } = useAppSettings();
  const [data, setData] = useState<SetupState | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [step, setStep] = useState(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchSetup().then(result => {
      if (!active) return;
      setData(result); setDraft(result.current);
    }).catch((caught: unknown) => { if (active) setError(translateError(caught)); });
    return () => { active = false; };
  }, [revision, translateError]);
  useEffect(() => { heading.current?.focus(); }, [step, finished]);

  function change(next: SetupDraft) { setDraft(next); setDirty(true); setPreview(null); setError(null); }
  function chooseTemplate(businessType: string) {
    const template = data?.templates.find(item => item.businessType === businessType);
    if (!draft || !template) return;
    const food = ['CAFE', 'BAKERY', 'RESTAURANT', 'FOOD_TRUCK'].includes(businessType);
    change({ ...draft, businessType: template.businessType, features: { ...template.features },
      labels: food ? { ...draft.labels, products: t('recommended.menu'), orders: t('recommended.tickets'), staff: t('recommended.team') } : draft.labels,
      defaults: { ...draft.defaults, ...template.defaults },
    });
  }
  async function next() {
    if (!draft) return;
    if (step !== STEPS.length - 2) { setStep(step + 1); return; }
    setBusy(true); setError(null);
    try { setPreview(await previewSetup(draft)); setStep(step + 1); }
    catch (caught) { setError(translateError(caught)); }
    finally { setBusy(false); }
  }
  async function save(skip: boolean) {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      if (skip) await skipSetup(); else await applySetup(draft);
      setDirty(false); setFinished(true);
      toast.success(t(skip ? 'skipped' : 'saved'));
      await refresh();
    } catch (caught) { setError(translateError(caught)); }
    finally { setBusy(false); }
  }
  const errorBlock = error ? <div role="alert" className="text-destructive space-y-2"><p>{error}</p>{!data ? <Button variant="outline" onClick={() => setRevision(revision + 1)}>{t('retry')}</Button> : null}</div> : null;
  if (!data || !draft) return errorBlock ?? <p role="status">{t('loading')}</p>;
  if (!data.templates.length) return <p>{t('empty')}</p>;
  if (finished) return <section className="space-y-4"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t('done')}</h1><p>{t('rerun')}</p><Button asChild><Link href="/admin/settings">{t('settings')}</Link></Button></section>;
  const stepKey = STEPS[step] ?? 'entry';
  const definitions = data.defaultDefinitions.filter(def => stepKey === 'products' ? def.key.startsWith('products.') : !def.key.startsWith('products.') && defaultRelevant(def.key, draft));
  const enabledAreas = new Set(data.features.filter(feature => draft.features[feature.key]).flatMap(feature => feature.area ? [feature.area] : []));
  // Products/customers/catalogue remain available independently of optional modules.
  for (const area of ['products', 'categories', 'customers', 'discounts', 'reviews'] as const) enabledAreas.add(area);
  const labelKeys = LABEL_KEYS.filter(key => key === 'products' || draft.features[key as keyof typeof draft.features]);

  return <section className="mx-auto max-w-4xl space-y-5" aria-busy={busy}>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-muted-foreground text-sm">{t('scope')}</p></header>
    <ol aria-label={t('stepsLabel')} className="flex flex-wrap gap-2 text-sm">{STEPS.map((key, index) => <li key={key} aria-current={step === index ? 'step' : undefined} className={step === index ? 'text-primary font-semibold' : 'text-muted-foreground'}>{t(`steps.${key}`)}{index < STEPS.length - 1 ? <span aria-hidden className="mx-2">/</span> : null}</li>)}</ol>
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{t(`steps.${stepKey}`)}</h2>
    {errorBlock}
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      {stepKey === 'entry' ? <div className="bg-card space-y-3 rounded-lg border p-4"><p>{t('intro')}</p><p className="text-muted-foreground text-sm">{t('rerun')}</p><p className="text-muted-foreground text-sm">{t('preserve')}</p></div> : null}
      {stepKey === 'business' ? <div className="space-y-3"><Label htmlFor="setup-business">{t('businessType')}</Label><Select value={draft.businessType} onValueChange={chooseTemplate}><SelectTrigger id="setup-business"><SelectValue /></SelectTrigger><SelectContent>{data.templates.map(template => <SelectItem key={template.businessType} value={template.businessType}>{tTypes(template.businessType)}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => chooseTemplate(draft.businessType)}>{t('loadTemplate')}</Button><p className="text-muted-foreground text-sm">{t('recommendations')}</p></div> : null}
      {stepKey === 'features' ? <div className="grid gap-3 sm:grid-cols-2">{data.features.map(feature => {
        const requiredBy = data.features.filter(item => draft.features[item.key] && item.dependsOn.includes(feature.key));
        return <div key={feature.key} className="bg-card rounded-lg border p-4"><div className="flex items-center gap-3"><Settings2 className="text-muted-foreground size-4 shrink-0" aria-hidden /><Checkbox id={`feature-${feature.key}`} checked={draft.features[feature.key]} disabled={!feature.canDisable || requiredBy.length > 0} onCheckedChange={checked => {
          const features = { ...draft.features, [feature.key]: checked === true };
          if (checked) for (const dependency of feature.dependsOn) features[dependency] = true;
          change({ ...draft, features });
        }} /><Label htmlFor={`feature-${feature.key}`} className="min-h-6 flex-1">{t(`features.${feature.key}.title`)}</Label></div><p className="text-muted-foreground mt-2 text-sm">{t(`features.${feature.key}.description`)}</p>{requiredBy.length ? <p className="mt-2 text-sm">{t('requiredBy', { features: listFormat(locale, requiredBy.map(item => t(`features.${item.key}.title`))) })}</p> : null}{!feature.canDisable ? <p className="mt-2 text-sm">{t('alwaysEnabled')}</p> : null}</div>;
      })}</div> : null}
      {stepKey === 'names' ? <div className="space-y-4"><p className="text-muted-foreground text-sm">{t('displayOnly')}</p><div className="grid gap-4 sm:grid-cols-2">{labelKeys.map(key => <div key={key} className="space-y-2"><Label htmlFor={`label-${key}`}>{tNav(key)}</Label><Input id={`label-${key}`} maxLength={40} dir="auto" value={draft.labels[key] ?? ''} placeholder={tNav(key)} onChange={event => change({ ...draft, labels: { ...draft.labels, [key]: event.target.value } })} /></div>)}</div></div> : null}
      {stepKey === 'products' || stepKey === 'operations' ? <div className="space-y-4"><p className="text-muted-foreground text-sm">{t(stepKey === 'products' ? 'catalogueHelp' : 'operationsHelp')}</p><div className="grid gap-4 sm:grid-cols-2">{definitions.map(definition => <SetupDefaultField key={definition.key} definition={definition} value={draft.defaults[definition.key] ?? definition.default} onChange={value => change({ ...draft, defaults: { ...draft.defaults, [definition.key]: value } })} />)}</div>{stepKey === 'products' ? <p className="text-muted-foreground text-sm">{t('catalogueExtensions')}</p> : <p className="text-muted-foreground text-sm">{t('branchHelp')}</p>}</div> : null}
      {stepKey === 'people' ? <div className="space-y-4"><p className="text-muted-foreground text-sm">{t('permissionsHelp')}</p>{data.roles.map(role => <fieldset key={role.role} className="rounded-lg border p-4" disabled={role.isLocked}><legend className="px-1 font-medium">{t(`roles.${role.role}`)}</legend>{role.isLocked ? <p className="text-muted-foreground text-sm">{t('lockedRole')}</p> : <div className="grid gap-3 sm:grid-cols-3">{AREAS.filter(area => enabledAreas.has(area)).map(area => {
        const areas = draft.rolePermissions[role.role] ?? role.areas;
        return <div key={area} className="flex min-h-11 items-center gap-2"><Checkbox id={`${role.role}-${area}`} checked={areas.includes(area)} onCheckedChange={checked => changeRole(role.role, area, checked === true, areas)} /><Label htmlFor={`${role.role}-${area}`}>{t(`areas.${area}`)}</Label></div>;
      })}</div>}</fieldset>)}</div> : null}
      {stepKey === 'review' && preview ? <SetupReview preview={preview} /> : null}
    </fieldset>
    <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
      {step > 0 ? <Button variant="outline" disabled={busy} onClick={() => { setStep(step - 1); setPreview(null); }}>{t('back')}</Button> : <Button variant="outline" disabled={busy} onClick={() => void save(true)}>{t('skip')}</Button>}
      {step < STEPS.length - 1 ? <Button disabled={busy} onClick={() => void next()}>{t(step === 0 ? 'start' : step === STEPS.length - 2 ? 'reviewAction' : 'next')}</Button> : <Button disabled={busy || !preview} onClick={() => void save(false)}><Check className="size-4" aria-hidden />{t('apply')}</Button>}
      <Button variant="ghost" asChild><Link href="/admin/settings">{t('cancel')}</Link></Button>
    </footer>
  </section>;

  function changeRole(role: StaffRole, area: Area, checked: boolean, areas: Area[]) {
    if (!draft) return;
    const nextAreas = checked ? [...areas, area] : areas.filter(item => item !== area);
    change({ ...draft, rolePermissions: { ...draft.rolePermissions, [role]: nextAreas } });
  }
}

function defaultRelevant(key: string, draft: SetupDraft): boolean {
  if (key.startsWith('pos.')) return draft.features.pos;
  if (key.startsWith('returns.')) return draft.features.returns;
  if (key.startsWith('inventory.')) return draft.features.inventory;
  return true;
}

function SetupDefaultField({ definition, value, onChange }: { definition: SetupState['defaultDefinitions'][number]; value: SetupValue; onChange: (value: SetupValue) => void }) {
  const t = useTranslations('setup');
  const label = t(`defaults.${definition.key.replaceAll('.', '_')}`);
  return <div className="space-y-2"><Label htmlFor={definition.key}>{label}</Label>{definition.type === 'boolean' ? <div className="flex min-h-11 items-center gap-2"><Checkbox id={definition.key} checked={value === true} onCheckedChange={checked => onChange(checked === true)} /><span className="text-muted-foreground text-sm">{t(value ? 'enabled' : 'hidden')}</span></div> : definition.type === 'enum' ? <Select value={String(value)} onValueChange={onChange}><SelectTrigger id={definition.key}><SelectValue /></SelectTrigger><SelectContent>{definition.options?.map(option => <SelectItem key={option} value={option}><bdi>{option}</bdi></SelectItem>)}</SelectContent></Select> : <Input id={definition.key} type="number" min={definition.min} max={definition.max} step="any" value={String(value)} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />}</div>;
}

function SetupReview({ preview }: { preview: SetupPreview }) {
  const t = useTranslations('setup');
  const locale = useLocale();
  const nav = useTranslations('nav');
  function displayValue(value: SetupValue): string { return typeof value === 'boolean' ? t(value ? 'enabled' : 'hidden') : String(value); }
  return <div className="space-y-4"><p>{t('preserve')}</p><div className="grid gap-4 sm:grid-cols-2">{(['enabledFeatures', 'disabledFeatures'] as const).map(group => <div key={group} className="rounded-lg border p-4"><h3 className="font-semibold">{t(group)}</h3><ul className="mt-2 space-y-1">{preview[group].map(key => <li key={key}>{t(`features.${key}.title`)}</li>)}</ul>{!preview[group].length ? <p>{t('none')}</p> : null}</div>)}</div>
    <h3 className="font-semibold">{t('steps.names')}</h3><dl className="grid gap-2 sm:grid-cols-2">{Object.entries(preview.labelChanges).map(([key, value]) => <div key={key}><dt className="text-muted-foreground text-sm">{nav(key)}</dt><dd><bdi>{value || nav(key)}</bdi></dd></div>)}</dl>
    <h3 className="font-semibold">{t('steps.operations')}</h3><dl className="grid gap-2 sm:grid-cols-2">{Object.entries(preview.settingChanges).map(([key, value]) => <div key={key}><dt className="text-muted-foreground text-sm">{t(`defaults.${key.replaceAll('.', '_')}`)}</dt><dd><bdi>{displayValue(value)}</bdi></dd></div>)}</dl>
    <h3 className="font-semibold">{t('steps.people')}</h3>{preview.permissionChanges.length ? preview.permissionChanges.map(change => <div key={change.role} className="rounded-lg border p-3"><strong>{t(`roles.${change.role}`)}</strong><p>{t('grant')}: {listFormat(locale, change.grant.map(area => t(`areas.${area}`))) || t('none')}</p><p>{t('revoke')}: {listFormat(locale, change.revoke.map(area => t(`areas.${area}`))) || t('none')}</p></div>) : <p>{t('permissionsUnchanged')}</p>}
    {preview.warnings.map(warning => <p key={`${warning.code}-${warning.feature}`} role="status" className="bg-muted rounded-lg border p-3">{t(`warnings.${warning.code}`, { feature: t(`features.${warning.feature}.title`) })}</p>)}
  </div>;
}
