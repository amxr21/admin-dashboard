'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
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

const FIELDS = [
  'name',
  'legalName',
  'kind',
  'taxId',
  'email',
  'phone',
  'addressLine',
  'city',
  'country',
  'currency',
  'timezone',
  'logoUrl',
] as const;

type Values = Record<string, string>;

function initial(business: BusinessSummary | null): Values {
  return Object.fromEntries(
    FIELDS.map((field) => [field, (business?.[field] as string | null | undefined) ?? '']),
  ) as Values;
}

export function BusinessForm({ businessId }: BusinessFormProps) {
  const t = useTranslations('branches.business');
  const translateError = useTranslatedApiError();
  const router = useRouter();

  const isEdit = businessId !== undefined;

  const [values, setValues] = useState<Values>(() => initial(null));
  const [isActive, setIsActive] = useState(true);
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
    <div className="max-w-2xl space-y-6">
      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div
            key={field}
            className={field === 'name' || field === 'addressLine' ? 'sm:col-span-2' : undefined}
          >
            <div className="space-y-2">
              <Label htmlFor={`business-${field}`}>
                {t(`fields.${field}`)}
                {field === 'name' ? (
                  <span className="text-destructive ms-1" aria-hidden>
                    *
                  </span>
                ) : null}
              </Label>
              <Input
                id={`business-${field}`}
                type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                value={values[field] ?? ''}
                onChange={(event) => set(field, event.target.value)}
                aria-invalid={field === 'name' && nameError ? true : undefined}
                aria-describedby={
                  field === 'name' && nameError ? 'business-name-error' : undefined
                }
              />
              {field === 'name' && nameError ? (
                <p id="business-name-error" role="alert" className="text-destructive text-sm">
                  {nameError}
                </p>
              ) : null}
              {field === 'legalName' || field === 'currency' || field === 'country' ? (
                <p className="text-muted-foreground text-xs">{t(`hints.${field}`)}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

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
