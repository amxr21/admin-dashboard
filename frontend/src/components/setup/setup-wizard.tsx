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
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';
import { AREAS, type Area, type StaffRole } from '@/config/areas';
import { SetupQuestions } from '@/components/setup/setup-questions';
import { applySetup, fetchSetup, previewSetup, skipSetup, SETUP_FEATURE_KEYS, type SetupDraft, type SetupPreview, type SetupState, type SetupValue } from '@/lib/setup-api';

// `names` is no longer its own step — a step whose default action is "leave
// every field blank" earned nothing. The label edits it held now live inline
// in the Review step (see SetupReview), where the owner is already looking at
// what will change and can rename in the same place.
const STEPS = ['entry', 'business', 'questions', 'features', 'products', 'people', 'operations', 'review'] as const;
/** Answered in the Questions step, so never repeated as raw fields later. */
const QUESTION_KEYS = new Set(['notifications.lowStockAlerts', 'setup.fulfilment', 'setup.sellsOnline', 'setup.paymentMethods', 'setup.wantsCampaigns']);
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
  const [finished, setFinished] = useState<'applied' | 'skipped' | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
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
  /**
   * Label edits happen INSIDE the Review step, which only renders while a
   * preview exists. Clearing the preview (as `change` does) would blank the
   * screen the edit is being made on. Labels feed neither the feature nor the
   * permission computation, and the preview echoes them straight from the
   * draft, so the preview stays valid — keep it.
   */
  function changeLabels(next: SetupDraft) { setDraft(next); setDirty(true); setError(null); }
  function chooseTemplate(businessType: string) {
    const template = data?.templates.find(item => item.businessType === businessType);
    if (!draft || !template) return;
    const food = ['CAFE', 'BAKERY', 'RESTAURANT', 'FOOD_TRUCK'].includes(businessType);
    change({ ...draft, businessType: template.businessType, features: { ...template.features },
      labels: { ...template.labels, ...(food ? { products: t('recommended.menu'), orders: t('recommended.tickets'), staff: t('recommended.team') } : {}) },
      defaults: { ...draft.defaults, ...template.defaults },
    });
  }
  async function syncSettings() {
    try { setRefreshFailed((await refresh()) === false); }
    catch { setRefreshFailed(true); }
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
      setDirty(false); setFinished(skip ? 'skipped' : 'applied');
      toast.success(t(skip ? 'skipped' : 'saved'));
      await syncSettings();
    } catch (caught) { setError(translateError(caught)); }
    finally { setBusy(false); }
  }
  const errorBlock = error ? <div role="alert" className="text-destructive space-y-2"><p>{error}</p>{!data ? <Button variant="outline" onClick={() => setRevision(revision + 1)}>{t('retry')}</Button> : null}</div> : null;
  if (!data || !draft) return errorBlock ?? <p role="status">{t('loading')}</p>;
  if (!data.templates.length) return <p>{t('empty')}</p>;
  if (finished) return <section className="space-y-4"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t(finished === 'skipped' ? 'skippedTitle' : 'done')}</h1><p>{t(finished === 'skipped' ? 'skipped' : 'rerun')}</p>{refreshFailed ? <div role="alert" className="space-y-2"><p>{t('refreshFailed')}</p><Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void syncSettings().finally(() => setBusy(false)); }}>{t('refreshAction')}</Button></div> : null}<Button asChild className="min-h-11"><Link href="/admin/settings">{t('settings')}</Link></Button></section>;
  const stepKey = STEPS[step] ?? 'entry';
  const definitions = data.defaultDefinitions.filter(def => !QUESTION_KEYS.has(def.key)).filter(def => stepKey === 'products' ? def.key.startsWith('products.') : !def.key.startsWith('products.') && defaultRelevant(def.key, draft));
  const enabledAreas = new Set(data.features.filter(feature => draft.features[feature.key]).flatMap(feature => feature.area ? [feature.area] : []));
  // Products/customers/catalogue remain available independently of optional modules.
  for (const area of ['products', 'categories', 'customers', 'discounts', 'reviews'] as const) enabledAreas.add(area);
  const labelKeys = LABEL_KEYS.filter(key => key === 'products' || draft.features[key as keyof typeof draft.features]);

  return <section className="mx-auto max-w-4xl space-y-5" aria-busy={busy}>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-muted-foreground text-sm">{t('scope')}</p></header>
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground" aria-hidden>{t('stepCounter', { current: step + 1, total: STEPS.length })}</p>
        {/* A thin progress bar backs the step list, so "how far is left" is
            legible at a glance on a 7-step flow. aria-hidden — the ordered
            list below carries the real semantics for assistive tech. */}
        <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full" aria-hidden><div className="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
      </div>
      <ol aria-label={t('stepsLabel')} className="flex flex-wrap gap-x-2 gap-y-1 text-sm">{STEPS.map((key, index) => {
        const state = index < step ? 'done' : index === step ? 'current' : 'upcoming';
        return <li key={key} aria-current={index === step ? 'step' : undefined} className={cn('flex items-center gap-1', state === 'current' ? 'text-primary font-semibold' : state === 'done' ? 'text-foreground' : 'text-muted-foreground')}>{state === 'done' ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}{t(`steps.${key}`)}{index < STEPS.length - 1 ? <span aria-hidden className="text-muted-foreground ms-2">/</span> : null}</li>;
      })}</ol>
    </div>
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{t(`steps.${stepKey}`)}</h2>
    {errorBlock}
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      {stepKey === 'entry' ? <div className="bg-card space-y-3 rounded-lg border p-4">
        {/* A returning owner already ran setup — say so, and what is in place,
            instead of the identical first-timer copy. `completedAt` is already
            returned by readSetup. */}
        {data.completedAt ? <p className="text-sm"><span className="font-medium">{t('lastConfigured', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(data.completedAt)) })}</span> {t('lastConfiguredType', { type: tTypes(draft.businessType) })}</p> : <p>{t('intro')}</p>}
        <p className="text-muted-foreground text-sm">{t('rerun')}</p>
        <p className="text-muted-foreground text-sm">{t('preserve')}</p>
        <p className="text-muted-foreground text-sm">{t('skipSafe')}</p>
      </div> : null}
      {stepKey === 'business' ? <div className="space-y-3"><Label htmlFor="setup-business">{t('businessType')}</Label><Select value={draft.businessType} onValueChange={chooseTemplate}><SelectTrigger id="setup-business" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent>{data.templates.map(template => <SelectItem key={template.businessType} value={template.businessType}>{tTypes(template.businessType)}</SelectItem>)}</SelectContent></Select><SetupTemplateSummary template={data.templates.find(item => item.businessType === draft.businessType)} /><Button variant="outline" className="min-h-11" onClick={() => chooseTemplate(draft.businessType)}>{t('loadTemplate')}</Button><p className="text-muted-foreground text-sm">{t('recommendations')}</p></div> : null}
      {stepKey === 'questions' ? <SetupQuestions draft={draft} onChange={change} /> : null}
      {stepKey === 'features' ? <div className="grid gap-3 sm:grid-cols-2">{data.features.map(feature => {
        const requiredBy = data.features.filter(item => draft.features[item.key] && item.dependsOn.includes(feature.key));
        return <div key={feature.key} className="bg-card rounded-lg border p-4"><div className="flex min-h-11 items-center gap-3"><Settings2 className="text-muted-foreground size-4 shrink-0" aria-hidden /><Checkbox id={`feature-${feature.key}`} checked={draft.features[feature.key]} disabled={!feature.canDisable || requiredBy.length > 0} onCheckedChange={checked => {
          const features = { ...draft.features, [feature.key]: checked === true };
          if (checked) for (const dependency of feature.dependsOn) features[dependency] = true;
          change({ ...draft, features });
        }} /><Label htmlFor={`feature-${feature.key}`} className="flex min-h-11 flex-1 items-center">{t(`features.${feature.key}.title`)}</Label></div><p className="text-muted-foreground mt-2 text-sm">{t(`features.${feature.key}.description`)}</p>{requiredBy.length ? <p className="mt-2 text-sm">{t('requiredBy', { features: listFormat(locale, requiredBy.map(item => t(`features.${item.key}.title`))) })}</p> : null}{!feature.canDisable ? <p className="mt-2 text-sm">{t('alwaysEnabled')}</p> : null}</div>;
      })}</div> : null}
      {stepKey === 'products' ? <div className="space-y-4"><p className="text-muted-foreground text-sm">{t('catalogueHelp')}</p><div className="grid gap-4 sm:grid-cols-2">{definitions.map(definition => <SetupDefaultField key={definition.key} definition={definition} value={draft.defaults[definition.key] ?? definition.default} onChange={value => change({ ...draft, defaults: { ...draft.defaults, [definition.key]: value } })} />)}</div><p className="text-muted-foreground text-sm">{t('catalogueExtensions')}</p></div> : null}
      {stepKey === 'operations' ? <SetupOperations definitions={definitions} draft={draft} onChange={change} /> : null}
      {stepKey === 'people' ? <div className="space-y-4"><p className="text-muted-foreground text-sm">{t('permissionsHelp')}</p>{data.roles.map(role => <fieldset key={role.role} className="rounded-lg border p-4" disabled={role.isLocked}><legend className="px-1 font-medium">{t(`roles.${role.role}`)}</legend>{role.isLocked ? <p className="text-muted-foreground text-sm">{t('lockedRole')}</p> : <div className="grid gap-3 sm:grid-cols-3">{AREAS.filter(area => enabledAreas.has(area)).map(area => {
        const areas = draft.rolePermissions[role.role] ?? role.areas;
        return <div key={area} className="flex min-h-11 items-center gap-2"><Checkbox id={`${role.role}-${area}`} checked={areas.includes(area)} onCheckedChange={checked => changeRole(role.role, area, checked === true, areas)} /><Label htmlFor={`${role.role}-${area}`} className="flex min-h-11 flex-1 items-center">{t(`areas.${area}`)}</Label></div>;
      })}</div>}</fieldset>)}</div> : null}
      {stepKey === 'review' && preview ? <SetupReview preview={preview} draft={draft} labelKeys={labelKeys} onChange={changeLabels} /> : null}
    </fieldset>
    <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
      {step > 0 ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => { setStep(step - 1); setPreview(null); }}>{t('back')}</Button> : <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void save(true)}>{t('skip')}</Button>}
      {step < STEPS.length - 1 ? <Button className="min-h-11" disabled={busy} onClick={() => void next()}>{t(step === 0 ? 'start' : step === STEPS.length - 2 ? 'reviewAction' : 'next')}</Button> : <Button className="min-h-11" disabled={busy || !preview} onClick={() => void save(false)}><Check className="size-4" aria-hidden />{t('apply')}</Button>}
      <Button variant="ghost" className="min-h-11" asChild><Link href="/admin/settings">{t('cancel')}</Link></Button>
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

/**
 * What choosing a business type gives you as a STARTING POINT — shown at the
 * moment of selection so the template's effect is visible, not discovered by
 * walking the next four steps. Describes the template's own preset, not the
 * live draft: the owner can still change everything in the steps that follow.
 */
function SetupTemplateSummary({ template }: { template: SetupDraft | undefined }) {
  const t = useTranslations('setup');
  const locale = useLocale();
  if (!template) return null;
  const enabled = SETUP_FEATURE_KEYS.filter(key => key !== 'dashboard' && key !== 'settings' && template.features[key]).map(key => t(`features.${key}.title`));
  const productDefaults = (['products.defaultHasVariants', 'products.defaultHasColors', 'products.defaultHasBarcode'] as const)
    .filter(key => template.defaults[key] === true)
    .map(key => t(`defaults.${key.replaceAll('.', '_')}`));
  return <div className="bg-muted/50 space-y-2 rounded-lg border p-3 text-sm">
    <p><span className="font-medium">{t('presetEnables')}</span> {enabled.length ? listFormat(locale, enabled) : t('none')}</p>
    {productDefaults.length ? <p><span className="font-medium">{t('presetProducts')}</span> {listFormat(locale, productDefaults)}</p> : null}
  </div>;
}

/**
 * The Defaults step, split so the common money settings are visible and the
 * five foreign-currency tender rates — which most shops leave at 0 — sit behind
 * one collapsed disclosure. Reuses the same `CollapsibleSection` the product
 * form uses for its field groups, rather than inventing a second idiom.
 */
function SetupOperations({ definitions, draft, onChange }: { definitions: SetupState['defaultDefinitions']; draft: SetupDraft; onChange: (next: SetupDraft) => void }) {
  const t = useTranslations('setup');
  const isTenderRate = (key: string) => key.startsWith('pos.tenderRate.');
  const money = definitions.filter(def => !isTenderRate(def.key));
  const tenderRates = definitions.filter(def => isTenderRate(def.key));
  // How many foreign tenders are actually switched on (rate > 0) — shown on the
  // collapsed header so an owner who set one sees it without expanding.
  const activeTenders = tenderRates.filter(def => Number(draft.defaults[def.key] ?? def.default) > 0).length;
  const field = (definition: SetupState['defaultDefinitions'][number]) => <SetupDefaultField key={definition.key} definition={definition} value={draft.defaults[definition.key] ?? definition.default} onChange={value => onChange({ ...draft, defaults: { ...draft.defaults, [definition.key]: value } })} />;
  return <div className="space-y-4">
    <p className="text-muted-foreground text-sm">{t('operationsHelp')}</p>
    <div className="grid gap-4 sm:grid-cols-2">{money.map(field)}</div>
    {tenderRates.length ? <CollapsibleSection title={t('foreignTenders')} defaultOpen={activeTenders > 0} aside={activeTenders > 0 ? t('foreignTendersActive', { count: activeTenders }) : t('foreignTendersOff')}>
      <p className="text-muted-foreground mb-3 text-sm">{t('foreignTendersHelp')}</p>
      <div className="grid gap-4 sm:grid-cols-2">{tenderRates.map(field)}</div>
    </CollapsibleSection> : null}
    <p className="text-muted-foreground text-sm">{t('branchHelp')}</p>
  </div>;
}

function SetupReview({ preview, draft, labelKeys, onChange }: { preview: SetupPreview; draft: SetupDraft; labelKeys: string[]; onChange: (next: SetupDraft) => void }) {
  const t = useTranslations('setup');
  const locale = useLocale();
  const nav = useTranslations('nav');
  function displayValue(key: string, value: SetupValue): string {
    if (typeof value === 'boolean') return t(value ? 'enabled' : 'hidden');
    // Answers stored as codes read back in words.
    if (key === 'setup.fulfilment') return t(`questions.fulfilment.${String(value)}`);
    if (key === 'setup.paymentMethods') return listFormat(locale, String(value).split(',').filter(Boolean).map(method => t(`questions.payments.${method}`)));
    return String(value);
  }
  return <div className="space-y-4"><p>{t('preserve')}</p><div className="grid gap-4 sm:grid-cols-2">{(['enabledFeatures', 'disabledFeatures'] as const).map(group => <div key={group} className="rounded-lg border p-4"><h3 className="font-semibold">{t(group)}</h3><ul className="mt-2 space-y-1">{preview[group].map(key => <li key={key}>{t(`features.${key}.title`)}</li>)}</ul>{!preview[group].length ? <p>{t('none')}</p> : null}</div>)}</div>
    {/* Label editing lives here now, not a step of its own. Optional: leaving a
        field blank keeps the built-in translated label. */}
    <div><h3 className="font-semibold">{t('steps.names')}</h3><p className="text-muted-foreground mb-2 text-sm">{t('displayOnly')}</p><div className="grid gap-4 sm:grid-cols-2">{labelKeys.map(key => <div key={key} className="space-y-2"><Label htmlFor={`label-${key}`}>{nav(key)}</Label><Input id={`label-${key}`} maxLength={40} dir="auto" value={draft.labels[key] ?? ''} placeholder={nav(key)} onChange={event => onChange({ ...draft, labels: { ...draft.labels, [key]: event.target.value } })} /></div>)}</div></div>
    <h3 className="font-semibold">{t('steps.operations')}</h3><dl className="grid gap-2 sm:grid-cols-2">{Object.entries(preview.settingChanges).map(([key, value]) => <div key={key}><dt className="text-muted-foreground text-sm">{t(`defaults.${key.replaceAll('.', '_')}`)}</dt><dd><bdi>{displayValue(key, value)}</bdi></dd></div>)}</dl>
    <h3 className="font-semibold">{t('steps.people')}</h3>{preview.permissionChanges.length ? preview.permissionChanges.map(change => <div key={change.role} className="rounded-lg border p-3"><strong>{t(`roles.${change.role}`)}</strong><p>{t('grant')}: {listFormat(locale, change.grant.map(area => t(`areas.${area}`))) || t('none')}</p><p>{t('revoke')}: {listFormat(locale, change.revoke.map(area => t(`areas.${area}`))) || t('none')}</p>{/* State the revoke as a consequence, not just a diff: whoever holds this role loses those areas on their next sign-in. */}{change.revoke.length ? <p className="text-muted-foreground mt-1 text-sm">{t('revokeConsequence', { role: t(`roles.${change.role}`), areas: listFormat(locale, change.revoke.map(area => t(`areas.${area}`))) })}</p> : null}</div>) : <p>{t('permissionsUnchanged')}</p>}
    {preview.warnings.map(warning => <p key={`${warning.code}-${warning.feature}`} role="status" className="bg-muted rounded-lg border p-3">{t(`warnings.${warning.code}`, { feature: t(`features.${warning.feature}.title`) })}</p>)}
  </div>;
}
