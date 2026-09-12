'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { ImageUploadField } from '@/components/image-upload-field';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  countryOptions,
  currencyOptions,
  exampleCityFor,
  timezoneOptions,
} from '@/lib/canonical-options';
import { BUSINESS_TYPES, toBusinessType } from '@/lib/business-types';
import { isValidTaxId, taxIdExampleFor, taxIdRuleFor } from '@/lib/tax-id';
import {
  createBusiness,
  fetchBusinesses,
  updateBusiness,
  type BusinessSummary,
} from '@/lib/branches-api';

/**
 * Create or edit a business (O7 stage 3).
 *
 * ─── A PAGE, NOT A SHEET ─────────────────────────────────────────────
 * The other pole of the drawer-vs-page convention. A business carries twelve
 * fields including the legal name and tax id that end up on an invoice, it is
 * a destination worth its own URL, and — unlike adding a branch — it is not a
 * detour from a list you are coming straight back to. A fixed-width drawer
 * would cramp it.
 *
 * ─── EVERY FIELD BUT `name` IS OPTIONAL ──────────────────────────────
 * Deliberate, and enforced on the server too: an owner setting up their first
 * business must not have to produce a tax id before they can add a product.
 * The letterhead falls back through branch -> business -> store setting, so an
 * unfilled field here is not a blank invoice, it is the store-wide value.
 */

interface BusinessFormProps {
  /** Absent when creating. */
  businessId?: string;
}

/**
 * Grouped rather than a flat list of twelve (O9.3).
 *
 * Twelve identical inputs in one column read as a form with no shape — the
 * owner's complaint was that it looked "so basic". Widening alone would only
 * make twelve undifferentiated inputs span more of the page, so they are
 * grouped by the question each one answers: what the shop is called, how to
 * reach it, where it is, and how it counts money.
 *
 * `logoUrl` is deliberately NOT in here — it is not a text input, and it
 * renders on its own below with the real uploader.
 */
const GROUPS = [
  { id: 'identity', fields: ['name', 'legalName', 'kind', 'taxId'] },
  { id: 'contact', fields: ['email', 'phone'] },
  { id: 'address', fields: ['addressLine', 'city', 'country'] },
  { id: 'locale', fields: ['currency', 'timezone'] },
] as const;

/** Every writable field, in payload order. `logoUrl` included — it is stored
 *  exactly like the others, it just has a better control. `kindNote` is not in
 *  a GROUP because it is not independently placed: it renders directly beneath
 *  `kind`, and only when that is `OTHER`. */
const FIELDS = [
  ...GROUPS.flatMap((group) => group.fields),
  'logoUrl',
  'kindNote',
] as const;

/** URG-016/017/018 — fields whose value must come from a canonical catalogue
 *  rather than being typed. The control differs (searchable vs a short list),
 *  so the renderer branches on this rather than on the field name inline. */
const CANONICAL_FIELDS = new Set(['country', 'currency', 'timezone']);

/** Full-width inside its group: a legal name or a street rarely fits the half
 *  column a two-up grid gives it. */
const WIDE_FIELDS = new Set(['name', 'legalName', 'addressLine']);

/**
 * URG-013 — a worked example per field, sharing `common.placeholders` with the
 * branch and staff forms rather than restating the same examples per form.
 *
 * `name` is deliberately absent: the label already says "Business name" and the
 * field is required and first, so an example adds nothing. `kind`, `country`,
 * `currency` and `timezone` are absent on purpose too — those are canonical
 * option sets that URG-016–024 turns into Selects, and hinting a free-text
 * format now would teach a shape the control is about to stop accepting.
 */
const BUSINESS_PLACEHOLDERS: Record<string, string | undefined> = {
  legalName: 'placeholders.legalName',
  taxId: 'placeholders.taxId',
  email: 'placeholders.email',
  phone: 'placeholders.phone',
  addressLine: 'placeholders.addressLine',
  city: 'placeholders.city',
  logoUrl: 'placeholders.url',
};

type Values = Record<string, string>;

function initial(business: BusinessSummary | null): Values {
  const values = Object.fromEntries(
    FIELDS.map((field) => [field, (business?.[field] as string | null | undefined) ?? '']),
  ) as Values;

  // URG-021 — a row stored before the catalogue holds free text ("cafe").
  // Map it to its code where the intent is unambiguous so the Select shows the
  // right option; anything unmappable keeps its raw text and is surfaced for
  // review by `legacyKind` below rather than being silently cleared.
  const mapped = toBusinessType(values.kind);
  if (mapped) values.kind = mapped;

  return values;
}

export function BusinessForm({ businessId }: BusinessFormProps) {
  const t = useTranslations('branches.business');
  // URG-013 — shared format-example placeholders, same strings every
  // email/phone input in the app uses (see resource-form.tsx's placeholderFor).
  const tCommon = useTranslations('common');
  const tTypes = useTranslations('businessTypes');
  const translateError = useTranslatedApiError();
  const router = useRouter();
  const locale = useLocale();

  // URG-016/017/018 — built from `Intl`, so they are locale-sensitive and
  // rebuild only when the locale changes, not on every keystroke in the form.
  // 162 currencies / 417 zones / ~250 countries is real work to sort.
  const optionsFor = useMemo(
    () => ({
      country: countryOptions(locale),
      currency: currencyOptions(locale),
      timezone: timezoneOptions(locale),
    }),
    [locale],
  );

  const isEdit = businessId !== undefined;

  const [values, setValues] = useState<Values>(() => initial(null));
  /**
   * URG-021 — the raw stored `kind` when it predates the catalogue AND matches
   * no alias, so the Select cannot represent it.
   *
   * Held separately rather than read off `values.kind`, because `initial()`
   * rewrites that to a catalogue code whenever the mapping succeeds. Only the
   * value as it arrived can tell the owner what the record actually said.
   */
  const [legacyKind, setLegacyKind] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  /**
   * URG-023 — derived, not state: it is a pure function of the tax id and the
   * currently selected country, so holding it separately would just create a
   * second copy to keep in sync. Changing the country re-evaluates it for free,
   * which is the behaviour the ticket asks for (a value valid in one
   * jurisdiction must not stay silently "valid" after switching to another).
   */
  const taxIdError = (() => {
    const raw = values.taxId ?? '';
    if (isValidTaxId(raw, values.country)) return null;
    const rule = taxIdRuleFor(values.country);
    return rule ? t(rule.hintKey) : null;
  })();
  const [isLoading, setIsLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;

    let cancelled = false;

    // There is no `GET /businesses/:id` — the list already carries every field
    // and one round trip is cheaper than adding an endpoint for the same data.
    void fetchBusinesses()
      .then((all) => {
        if (cancelled) return;

        const found = all.find((business) => business.id === businessId);

        if (!found) {
          setError(t('notFound'));
          return;
        }

        setValues(initial(found));
        // Unmappable free text: shown back to the owner for review rather than
        // discarded. A value that DID map needs no notice — it is already
        // selected correctly.
        const stored = found.kind?.trim();
        setLegacyKind(stored && !toBusinessType(stored) ? stored : null);
        setIsActive(found.isActive);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, isEdit, t, translateError]);

  function set(field: string, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === 'name') setNameError(null);
  }

  async function submit() {
    if (!(values.name ?? '').trim()) {
      setNameError(t('nameRequired'));
      return;
    }

    setIsSaving(true);
    setError(null);

    // Blank optional fields are sent as null, not '' — the brand fallback
    // treats an empty string as "not set", and storing one would make an
    // unfilled business field beat a filled-in store setting.
    const payload = {
      name: (values.name ?? '').trim(),
      ...Object.fromEntries(
        FIELDS.filter((field) => field !== 'name').map((field) => [
          field,
          (values[field] ?? '').trim() || null,
        ]),
      ),
      isActive,
    };

    try {
      if (isEdit) {
        await updateBusiness(businessId, payload);
        toast.success(t('updated'));
      } else {
        await createBusiness(payload);
        toast.success(t('created'));
      }

      // Full reload rather than router.push: the branch switcher in the
      // topbar loads once on mount, and a new business's branches would not
      // appear in it otherwise.
      window.location.href = '/admin/branches';
    } catch (caught) {
      setError(
        caught instanceof ApiError && (caught.status === 400 || caught.status === 409)
          ? caught.message
          : translateError(caught),
      );
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-md" />
      </div>
    );
  }

  return (
    // Was `max-w-2xl`, which squeezed twelve fields into half the page and
    // left the whole form hugging the start edge (O9.3). `4xl` is wide enough
    // for a two-up grid to breathe without the line lengths becoming a
    // reading problem.
    <div className="max-w-4xl space-y-6">
      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {GROUPS.map((group) => (
        <section key={group.id} className="space-y-4 rounded-lg border p-4 sm:p-6">
          <div>
            <h2 className="font-medium">{t(`groups.${group.id}.title`)}</h2>
            <p className="text-muted-foreground text-sm">{t(`groups.${group.id}.hint`)}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((field) => (
              <div
                key={field}
                className={WIDE_FIELDS.has(field) ? 'space-y-2 sm:col-span-2' : 'space-y-2'}
              >
                <Label htmlFor={`business-${field}`}>
                  {t(`fields.${field}`)}
                  {field === 'name' ? (
                    <span className="text-destructive ms-1" aria-hidden>
                      *
                    </span>
                  ) : null}
                </Label>
                {CANONICAL_FIELDS.has(field) ? (
                  <Combobox
                    id={`business-${field}`}
                    options={optionsFor[field as 'country' | 'currency' | 'timezone']}
                    value={values[field] || null}
                    onValueChange={(next) => set(field, next ?? '')}
                    placeholder={
                      field === 'country'
                        ? t('chooseCountry')
                        : field === 'currency'
                          ? t('chooseCurrency')
                          : t('chooseTimezone')
                    }
                    searchPlaceholder={tCommon('combobox.search')}
                    emptyText={tCommon('combobox.empty')}
                    clearText={tCommon('combobox.none')}
                  />
                ) : field === 'kind' ? (
                  <Select
                    value={values.kind || 'none'}
                    onValueChange={(next) => {
                      set('kind', next === 'none' ? '' : next);
                      // Leaving OTHER must not strand its note: the server
                      // refuses a note on any other type, so keeping it would
                      // turn a type change into an unexplainable 400.
                      if (next !== 'OTHER') set('kindNote', '');
                    }}
                  >
                    <SelectTrigger id="business-kind" className="w-full">
                      <SelectValue placeholder={t('kindPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tCommon('combobox.none')}</SelectItem>
                      {BUSINESS_TYPES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {tTypes(code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field === 'phone' ? (
                  /* URG-020/022 — validated against the country chosen in this
                     same form, so the example and the rules match what the
                     owner just picked rather than a fixed locale. */
                  <PhoneField
                    id="business-phone"
                    value={values.phone ?? ''}
                    onChange={(next) => set('phone', next)}
                    country={values.country || null}
                  />
                ) : (
                  <Input
                    id={`business-${field}`}
                    type={field === 'email' ? 'email' : 'text'}
                    placeholder={
                      // URG-023 — the country's own example beats a fixed one:
                      // a UAE sample on a business registered elsewhere teaches
                      // the wrong shape. Falls back to the shared placeholder
                      // when the jurisdiction has no rule.
                      field === 'taxId' && taxIdExampleFor(values.country)
                        ? (taxIdExampleFor(values.country) ?? undefined)
                        : // URG-019 — the country's own example city. Not
                          // validation: free text stays free text, this only
                          // stops "e.g. Dubai" appearing on a business
                          // registered somewhere else.
                          field === 'city' && exampleCityFor(values.country)
                          ? (exampleCityFor(values.country) ?? undefined)
                          : BUSINESS_PLACEHOLDERS[field]
                            ? tCommon(BUSINESS_PLACEHOLDERS[field])
                            : undefined
                    }
                    value={values[field] ?? ''}
                    onChange={(event) => set(field, event.target.value)}
                    aria-invalid={
                      (field === 'name' && nameError) || (field === 'taxId' && taxIdError)
                        ? true
                        : undefined
                    }
                    aria-describedby={
                      field === 'name' && nameError
                        ? 'business-name-error'
                        : field === 'taxId' && taxIdError
                          ? 'business-taxid-error'
                          : undefined
                    }
                  />
                )}

                {/* URG-023 — shown as soon as the shape is wrong, so the owner
                    is not told only after pressing Save. The server enforces
                    the same rule; this is the earlier, kinder half of it. */}
                {field === 'taxId' && taxIdError ? (
                  <p id="business-taxid-error" role="alert" className="text-destructive text-sm">
                    {taxIdError}
                  </p>
                ) : null}

                {/* URG-021 — the escape hatch's note, required by the server
                    when the type is OTHER and refused for any other type. */}
                {field === 'kind' && values.kind === 'OTHER' ? (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="business-kind-note">{t('kindNoteLabel')}</Label>
                    <Input
                      id="business-kind-note"
                      maxLength={200}
                      placeholder={t('kindNotePlaceholder')}
                      value={values.kindNote ?? ''}
                      onChange={(event) => set('kindNote', event.target.value)}
                    />
                  </div>
                ) : null}

                {/* A stored value that predates the catalogue and matches no
                    alias. Shown, not silently discarded — the owner is the only
                    one who can say which type it meant. */}
                {field === 'kind' && legacyKind ? (
                  <p className="text-muted-foreground text-xs">
                    {t('kindLegacyReview', { value: legacyKind })}
                  </p>
                ) : null}
                {field === 'name' && nameError ? (
                  <p id="business-name-error" role="alert" className="text-destructive text-sm">
                    {nameError}
                  </p>
                ) : null}
                {field === 'legalName' || field === 'currency' || field === 'country' ? (
                  <p className="text-muted-foreground text-xs">{t(`hints.${field}`)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* O9.2 — was a plain text input asking for a pasted image URL, while
          the real Cloudinary uploader already existed and was already wired
          into Settings and the resource form. Same `logo` folder as the
          store-wide logo in Settings: they are the same kind of asset, and
          two folders for one concept makes the media library harder to read.
          The component keeps a paste-a-URL fallback of its own for a
          deployment that has not configured Cloudinary. */}
      <section className="space-y-4 rounded-lg border p-4 sm:p-6">
        <div>
          <h2 className="font-medium">{t('groups.brand.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('groups.brand.hint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="business-logoUrl">{t('fields.logoUrl')}</Label>
          <ImageUploadField
            id="business-logoUrl"
            value={values.logoUrl ?? ''}
            onChange={(url) => set('logoUrl', url)}
            folder="logo"
            disabled={isSaving}
          />
        </div>
      </section>

      {isEdit ? (
        <div className="flex items-start gap-3 border-t pt-4">
          <Checkbox
            id="business-active"
            checked={isActive}
            onCheckedChange={(checked) => setIsActive(checked === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="business-active">{t('fields.isActive')}</Label>
            <p className="text-muted-foreground text-xs">{t('hints.isActive')}</p>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={() => router.push('/admin/branches')} disabled={isSaving}>
          {t('cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={isSaving}>
          {isSaving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
