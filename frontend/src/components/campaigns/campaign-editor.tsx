'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Monitor, Send, Smartphone, TestTube2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { CampaignAudienceBuilder } from '@/components/campaigns/campaign-audience-builder';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { fetchBranch, fetchBranches, type BranchSummary } from '@/lib/branches-api';
import { fillPlaceholders, PLACEHOLDERS, QUARTER_HOURS, zonedToUtc, type Placeholder } from '@/lib/campaign-content';
import {
  deleteCampaign,
  previewCampaignAudience,
  saveCampaign,
  sendCampaign,
  testSendCampaign,
  type AudiencePreview,
  type Campaign,
  type CampaignChannel,
  type CampaignInput,
} from '@/lib/campaigns-api';
import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from '@/lib/campaign-templates';
import { toIsoDate } from '@/lib/reports-api';

const ALL_BRANCHES = '__all__';
type Lang = 'en' | 'ar';

const EMPTY: CampaignInput = {
  name: '',
  channel: 'EMAIL',
  subjectEn: '',
  subjectAr: '',
  bodyEn: '',
  bodyAr: '',
  discountCode: '',
  branchId: null,
  audience: { mode: 'filter' },
};

function toInput(campaign: Campaign): CampaignInput {
  return {
    name: campaign.name,
    channel: campaign.channel,
    subjectEn: campaign.subjectEn ?? '',
    subjectAr: campaign.subjectAr ?? '',
    bodyEn: campaign.bodyEn ?? '',
    bodyAr: campaign.bodyAr ?? '',
    discountCode: campaign.discountCode ?? '',
    branchId: campaign.branchId,
    audience: campaign.audience,
  };
}

/**
 * Create or edit a draft (or scheduled) campaign.
 *
 * Nothing leaves until "Send": saving only stores the draft, the audience
 * panel only counts, and a test goes to the person testing. The reach and
 * cost figures refresh as the audience or message changes, so the send
 * decision is made looking at the real numbers.
 */
export function CampaignEditor({ campaign }: { campaign: Campaign | null }) {
  const t = useTranslations('campaigns.editor');
  const tc = useTranslations('campaigns');
  const translateError = useTranslatedApiError();
  const router = useRouter();
  const [input, setInput] = useState<CampaignInput>(campaign ? toInput(campaign) : EMPTY);
  const [saved, setSaved] = useState<Campaign | null>(campaign);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [dialog, setDialog] = useState<'send' | 'test' | null>(null);
  const bodyRefs = { en: useRef<HTMLTextAreaElement>(null), ar: useRef<HTMLTextAreaElement>(null) };

  useEffect(() => {
    void fetchBranches().then(setBranches).catch(() => setBranches([]));
  }, []);

  function update(patch: Partial<CampaignInput>) {
    setInput((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  // Live reach and cost, debounced so typing does not fire a request a key.
  const previewKey = JSON.stringify([input.channel, input.audience, input.channel === 'SMS' ? [input.bodyEn, input.bodyAr] : null]);
  useEffect(() => {
    const timer = setTimeout(() => {
      previewCampaignAudience({ channel: input.channel, audience: input.audience, bodyEn: input.bodyEn, bodyAr: input.bodyAr })
        .then((result) => {
          setPreview(result);
          setPreviewError(null);
        })
        .catch((caught: unknown) => setPreviewError(translateError(caught)));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewKey captures exactly the inputs that change the preview
  }, [previewKey, translateError]);

  function insertPlaceholder(lang: Lang, placeholder: Placeholder) {
    const key = lang === 'ar' ? 'bodyAr' : 'bodyEn';
    const element = bodyRefs[lang].current;
    const current = input[key] ?? '';
    const token = `{{${placeholder}}}`;
    const at = element?.selectionStart ?? current.length;
    update({ [key]: current.slice(0, at) + token + current.slice(element?.selectionEnd ?? at) });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  // The code hint contains {{discount_code}}, which ICU would try to format
  // as an argument — read it verbatim.
  const raw = (key: string) => String(t.raw(key));

  function applyTemplate(template: CampaignTemplate) {
    const copy = CAMPAIGN_TEMPLATES[template];
    const sms = input.channel === 'SMS';
    update({
      subjectEn: sms ? '' : copy.subjectEn,
      subjectAr: sms ? '' : copy.subjectAr,
      bodyEn: sms ? copy.smsEn : copy.bodyEn,
      bodyAr: sms ? copy.smsAr : copy.bodyAr,
    });
  }

  async function save(): Promise<Campaign | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await saveCampaign(input, saved?.id);
      setSaved(result);
      setDirty(false);
      // Give a new draft its own address without navigating: a navigation
      // would remount this editor and close a Send or Test dialog opened
      // right after the first save.
      if (!saved) {
        window.history.replaceState(null, '', window.location.pathname.replace(/\/new$/, `/${result.id}`));
      }
      return result;
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 400 ? caught.message : translateError(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!saved) return;
    setBusy(true);
    try {
      await deleteCampaign(saved.id);
      toast.success(t('deleted'));
      router.push('/admin/campaigns');
    } catch (caught) {
      setError(translateError(caught));
      setBusy(false);
    }
  }

  const canSave = input.name.trim().length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        {error ? (
          <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <section className="bg-card space-y-4 rounded-lg border p-4" aria-labelledby="campaign-basics">
          <h2 id="campaign-basics" className="font-semibold">
            {t('basics')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">{t('name')}</Label>
              <Input id="campaign-name" value={input.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label id="campaign-channel-label">{t('channel')}</Label>
              <SegmentedControl
                aria-labelledby="campaign-channel-label"
                value={input.channel}
                onChange={(channel) => update({ channel: channel as CampaignChannel })}
                options={[
                  { value: 'EMAIL', label: tc('channel.EMAIL') },
                  { value: 'SMS', label: tc('channel.SMS') },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-branch">{t('branch')}</Label>
              <Select value={input.branchId ?? ALL_BRANCHES} onValueChange={(value) => update({ branchId: value === ALL_BRANCHES ? null : value })}>
                <SelectTrigger id="campaign-branch" aria-describedby="campaign-branch-hint">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES}>{t('wholeBusiness')}</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="campaign-branch-hint" className="text-muted-foreground text-xs">
                {t('branchHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-code">{t('discountCode')}</Label>
              <Input
                id="campaign-code"
                className="force-ltr"
                maxLength={64}
                value={input.discountCode ?? ''}
                onChange={(event) => update({ discountCode: event.target.value })}
                aria-describedby="campaign-code-hint"
              />
              <p id="campaign-code-hint" className="text-muted-foreground text-xs">
                {raw('discountCodeHint')}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-card space-y-4 rounded-lg border p-4" aria-labelledby="campaign-message">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="campaign-message" className="font-semibold">
              {t('message')}
            </h2>
            <Select onValueChange={(value) => applyTemplate(value as CampaignTemplate)}>
              <SelectTrigger className="h-8 w-auto" aria-label={t('templates.label')}>
                <SelectValue placeholder={t('templates.label')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discount">{t('templates.discount.name')}</SelectItem>
                <SelectItem value="clearance">{t('templates.clearance.name')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-muted-foreground text-sm">{t('languagesHint')}</p>

          {(['en', 'ar'] as const).map((lang) => {
            const subjectKey = lang === 'ar' ? 'subjectAr' : 'subjectEn';
            const bodyKey = lang === 'ar' ? 'bodyAr' : 'bodyEn';
            return (
              <fieldset key={lang} className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t(`language.${lang}`)}</legend>
                {input.channel === 'EMAIL' ? (
                  <div className="space-y-2">
                    <Label htmlFor={`campaign-subject-${lang}`}>{t('subject')}</Label>
                    <Input
                      id={`campaign-subject-${lang}`}
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                      maxLength={200}
                      value={input[subjectKey] ?? ''}
                      onChange={(event) => update({ [subjectKey]: event.target.value })}
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor={`campaign-body-${lang}`}>{t('body')}</Label>
                  <Textarea
                    id={`campaign-body-${lang}`}
                    dir={lang === 'ar' ? 'rtl' : 'ltr'}
                    ref={bodyRefs[lang]}
                    rows={input.channel === 'SMS' ? 4 : 8}
                    maxLength={5000}
                    value={input[bodyKey] ?? ''}
                    onChange={(event) => update({ [bodyKey]: event.target.value })}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('insertLabel')}>
                  <span className="text-muted-foreground text-xs">{t('insert')}</span>
                  {PLACEHOLDERS.map((placeholder) => (
                    <Button
                      key={placeholder}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => insertPlaceholder(lang, placeholder)}
                    >
                      {t(`placeholders.${placeholder}`)}
                    </Button>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </section>

        <section className="bg-card space-y-4 rounded-lg border p-4" aria-labelledby="campaign-audience">
          <h2 id="campaign-audience" className="font-semibold">
            {t('audience')}
          </h2>
          <CampaignAudienceBuilder value={input.audience} onChange={(audience) => update({ audience })} />
        </section>

        <CollapsibleSection title={t('previewTitle')} defaultOpen>
          <MessagePreview input={input} branches={branches} />
        </CollapsibleSection>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="button" disabled={busy || !canSave} onClick={() => void save().then((result) => result && toast.success(t('savedToast')))}>
            {t('save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !canSave}
            onClick={() => void (dirty || !saved ? save() : Promise.resolve(saved)).then((result) => result && setDialog('test'))}
          >
            <TestTube2 aria-hidden />
            {t('testSend')}
          </Button>
          <Button
            type="button"
            variant="default"
            className="ms-auto"
            disabled={busy || !canSave || (preview?.eligible ?? 0) === 0}
            onClick={() => void (dirty || !saved ? save() : Promise.resolve(saved)).then((result) => result && setDialog('send'))}
          >
            <Send aria-hidden />
            {t('sendOrSchedule')}
          </Button>
          {saved && saved.status === 'DRAFT' ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
              <Trash2 aria-hidden />
              {t('delete')}
            </Button>
          ) : null}
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <ReachPanel preview={preview} error={previewError} channel={input.channel} />
      </aside>

      {saved ? (
        <>
          <TestSendDialog open={dialog === 'test'} onClose={() => setDialog(null)} campaign={saved} />
          <SendDialog
            open={dialog === 'send'}
            onClose={() => setDialog(null)}
            campaign={saved}
            eligible={preview?.eligible ?? 0}
            threshold={preview?.largeAudienceThreshold ?? Number.POSITIVE_INFINITY}
            onSent={(result) => {
              setSaved(result);
              router.refresh();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function ReachPanel({ preview, error, channel }: { preview: AudiencePreview | null; error: string | null; channel: CampaignChannel }) {
  const t = useTranslations('campaigns.reach');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  return (
    <section className="bg-card space-y-3 rounded-lg border p-4" aria-labelledby="reach-title" aria-live="polite">
      <h2 id="reach-title" className="font-semibold">
        {t('title')}
      </h2>
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !preview ? (
        <p className="text-muted-foreground text-sm">{t('counting')}</p>
      ) : (
        <>
          <p>
            <span className="text-3xl font-semibold tabular-nums">{formatter.number(preview.eligible)}</span>{' '}
            <span className="text-muted-foreground text-sm">{t('willReceive')}</span>
          </p>
          <dl className="text-muted-foreground space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt>{t('matched')}</dt>
              <dd className="tabular-nums">{formatter.number(preview.matched)}</dd>
            </div>
            {(['noConsent', 'noAddress', 'suppressed'] as const).map((reason) => (
              <div key={reason} className="flex justify-between gap-2">
                <dt>{t(`excluded.${reason}.${channel}`)}</dt>
                <dd className="tabular-nums">−{formatter.number(preview.excluded[reason])}</dd>
              </div>
            ))}
          </dl>
          {preview.sample.length ? (
            <p className="text-muted-foreground text-xs">{t('sample', { names: preview.sample.join(', ') })}</p>
          ) : null}
          {preview.sms ? (
            <div className="border-t pt-3 text-sm">
              <p>{t('segments', { count: preview.sms.segmentsPerMessage })}</p>
              <p className="text-muted-foreground">
                {preview.sms.estimatedCost === null
                  ? t('costUnknown')
                  : t('cost', { amount: formatCurrency(Number(preview.sms.estimatedCost)), segments: preview.sms.totalSegments })}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** What a recipient sees, with sample values, on a desktop or phone width. */
function MessagePreview({ input, branches }: { input: CampaignInput; branches: BranchSummary[] }) {
  const t = useTranslations('campaigns.editor');
  const locale = useLocale();
  const { storeName } = useAppSettings();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [lang, setLang] = useState<Lang>(locale === 'ar' ? 'ar' : 'en');

  const values = useMemo(
    () => ({
      customerName: lang === 'ar' ? 'مريم علي' : 'Mariam Ali',
      storeName: storeName || 'Store',
      branchName: branches.find((branch) => branch.id === input.branchId)?.name ?? (storeName || 'Store'),
      discountCode: input.discountCode?.trim() || 'CODE',
    }),
    [lang, storeName, branches, input.branchId, input.discountCode],
  );

  const subject = fillPlaceholders((lang === 'ar' ? input.subjectAr : input.subjectEn) ?? '', values);
  const body = fillPlaceholders((lang === 'ar' ? input.bodyAr : input.bodyEn) ?? '', values);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SegmentedControl
          aria-label={t('previewDevice')}
          value={device}
          onChange={(value) => setDevice(value as 'desktop' | 'mobile')}
          options={[
            { value: 'desktop', label: t('desktop') },
            { value: 'mobile', label: t('mobile') },
          ]}
        />
        <SegmentedControl
          aria-label={t('previewLanguage')}
          value={lang}
          onChange={(value) => setLang(value as Lang)}
          options={[
            { value: 'en', label: t('language.en') },
            { value: 'ar', label: t('language.ar') },
          ]}
        />
      </div>
      <div className="bg-muted flex justify-center rounded-lg p-4">
        <div
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          lang={lang}
          className="bg-background w-full rounded-lg border p-4 shadow-xs transition-[max-width]"
          style={{ maxWidth: device === 'mobile' ? 360 : 600 }}
        >
          <p className="text-muted-foreground mb-2 flex items-center gap-1 text-xs" aria-hidden>
            {device === 'mobile' ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
          </p>
          {input.channel === 'EMAIL' ? (
            <>
              <p className="font-semibold">{subject || t('noSubject')}</p>
              <div className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{body || t('noBody')}</div>
              <p className="text-muted-foreground mt-4 border-t pt-3 text-center text-xs">{t('unsubscribeFooter')}</p>
            </>
          ) : (
            <div className="bg-muted max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap">
              {body || t('noBody')}
              {'\n'}
              {lang === 'ar' ? 'أرسل STOP لإلغاء الاشتراك' : 'Reply STOP to opt out'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TestSendDialog({ open, onClose, campaign }: { open: boolean; onClose: () => void; campaign: Campaign }) {
  const t = useTranslations('campaigns.test');
  const translateError = useTranslatedApiError();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await testSendCampaign(campaign.id, campaign.channel === 'SMS' ? phone.trim() : undefined);
      toast.success(t('sent'));
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 400 ? caught.message : translateError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md space-y-3">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{campaign.channel === 'EMAIL' ? t('emailBody') : t('smsBody')}</DialogDescription>
        {campaign.channel === 'SMS' ? (
          <div className="space-y-2">
            <Label htmlFor="test-phone">{t('phone')}</Label>
            <Input id="test-phone" className="force-ltr" inputMode="tel" placeholder="+971501234567" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        ) : null}
        {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={busy || (campaign.channel === 'SMS' && !phone.trim())} onClick={() => void submit()}>
            {t('send')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SendDialog({
  open,
  onClose,
  campaign,
  eligible,
  threshold,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  eligible: number;
  threshold: number;
  onSent: (campaign: Campaign) => void;
}) {
  const t = useTranslations('campaigns.send');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [time, setTime] = useState('10:00');
  const [timeZone, setTimeZone] = useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scheduled in the campaign branch's own timezone (or the default branch's).
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetchBranches()
      .then((list) => campaign.branchId ?? list.find((branch) => branch.isDefault)?.id ?? null)
      .then((id) => (id ? fetchBranch(id) : null))
      .then((branch) => {
        if (active && branch?.timezone) setTimeZone(branch.timezone);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, campaign.branchId]);

  const needsConfirm = eligible >= threshold;
  const confirmed = !needsConfirm || Number(confirm) === eligible;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await sendCampaign(campaign.id, {
        ...(when === 'later' ? { sendAt: zonedToUtc(date, time, timeZone).toISOString() } : {}),
        ...(needsConfirm ? { confirmRecipients: Number(confirm) } : {}),
      });
      toast.success(t(result.status === 'SCHEDULED' ? 'scheduled' : 'sending'));
      onSent(result);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 400 ? caught.message : translateError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md space-y-4">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('summary', { count: eligible, name: campaign.name })}</DialogDescription>

        <SegmentedControl
          aria-label={t('whenLabel')}
          value={when}
          onChange={(value) => setWhen(value as 'now' | 'later')}
          options={[
            { value: 'now', label: t('now') },
            { value: 'later', label: t('later') },
          ]}
        />

        {when === 'later' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="send-date">{t('date')}</Label>
              <DatePicker id="send-date" value={date} onChange={setDate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-time">{t('time')}</Label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger id="send-time" className="force-ltr">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUARTER_HOURS.map((option) => (
                    <SelectItem key={option} value={option}>
                      <bdi>{option}</bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground col-span-2 text-xs">{t('timezone', { zone: timeZone })}</p>
          </div>
        ) : null}

        {needsConfirm ? (
          <div className="space-y-2">
            <Label htmlFor="send-confirm">{t('confirmLabel', { count: formatter.number(eligible) })}</Label>
            <Input id="send-confirm" inputMode="numeric" className="force-ltr" value={confirm} onChange={(event) => setConfirm(event.target.value.trim())} />
          </div>
        ) : null}

        {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={busy || !confirmed} onClick={() => void submit()}>
            {when === 'later' ? t('schedule') : t('sendNow')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
