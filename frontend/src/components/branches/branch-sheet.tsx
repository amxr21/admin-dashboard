'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  createBranch,
  updateBranch,
  type BusinessSummary,
} from '@/lib/branches-api';

/**
 * Create or edit a branch.
 *
 * ─── A SHEET, NOT A PAGE ─────────────────────────────────────────────
 * Per the drawer-vs-page convention: this is a brief detour from the branches
 * list the user is coming right back to, the field set is short, and the list
 * underneath is useful context (you are usually adding a SECOND branch, and
 * seeing the first one while you do is the point). A business gets a full page
 * instead — more fields, and a destination worth its own URL.
 *
 * ─── A WAREHOUSE IS NOT A SEPARATE THING ─────────────────────────────
 * `isSellingPoint: false` is the whole difference. Modelling it as its own
 * concept would mean every query meaning "somewhere stock can be" had to
 * remember to union two tables.
 */

type BranchRow = BusinessSummary['branches'][number];

interface BranchSheetProps {
  /** The business this branch belongs to. Never editable — see the API note:
   *  moving a branch between businesses would take its orders and stock with
   *  it, silently re-attributing revenue that has already been reported. */
  business: BusinessSummary;
  branch: BranchRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}

const TEXT_FIELDS = ['name', 'code', 'addressLine', 'city', 'phone'] as const;

/** URG-013 — a worked example per field, not one generic hint. Keys live in
 *  `common.placeholders` beside the existing email/phone/url so there is one
 *  place a shared example lives, rather than a per-form copy of the same idea. */
const BRANCH_PLACEHOLDERS: Partial<Record<(typeof TEXT_FIELDS)[number], string>> = {
  name: 'placeholders.branchName',
  code: 'placeholders.branchCode',
  addressLine: 'placeholders.addressLine',
  city: 'placeholders.city',
  phone: 'placeholders.phone',
};

type Values = Record<string, string>;

function initial(branch: BranchRow | null): Values {
  return {
    name: branch?.name ?? '',
    code: branch?.code ?? '',
    // The list projection does not carry these, so an edit starts blank for
    // them rather than showing a stale value it never had.
    addressLine: '',
    city: branch?.city ?? '',
    phone: '',
  };
}

export function BranchSheet({
  business,
  branch,
  open,
  onOpenChange,
  onSaved,
}: BranchSheetProps) {
  const t = useTranslations('branches.form');
  // URG-013 — shared format-example placeholder, same string every phone
  // input in the app uses (see resource-form.tsx's placeholderFor).
  const tCommon = useTranslations('common');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [values, setValues] = useState<Values>(() => initial(branch));
  const [isSellingPoint, setIsSellingPoint] = useState(branch?.isSellingPoint ?? true);
  const [isActive, setIsActive] = useState(branch?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(branch?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEdit = branch !== null;

  useEffect(() => {
    if (!open) return;
    setValues(initial(branch));
    setIsSellingPoint(branch?.isSellingPoint ?? true);
    setIsActive(branch?.isActive ?? true);
    setIsDefault(branch?.isDefault ?? false);
    setError(null);
    setNameError(null);
  }, [open, branch]);

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

    // An empty optional field is sent as null rather than '' — the API treats
    // a blank code as "no code", and '' would occupy the unique constraint.
    const text = Object.fromEntries(
      TEXT_FIELDS.filter((field) => field !== 'name').map((field) => [
        field,
        (values[field] ?? '').trim() || null,
      ]),
    );

    try {
      const payload = {
        name: (values.name ?? '').trim(),
        ...text,
        isSellingPoint,
        isDefault,
      };

      const saved = isEdit
        ? await updateBranch(branch.id, { ...payload, isActive })
        : await createBranch({ ...payload, businessId: business.id });

      onSaved(t(isEdit ? 'updated' : 'created', { name: saved.name }));
      onOpenChange(false);
    } catch (caught) {
      // The API's 400/409 names the field (a duplicate code, the last active
      // branch) — keep that message rather than flattening it to "failed".
      setError(
        caught instanceof ApiError && (caught.status === 400 || caught.status === 409)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="max-w-md overflow-y-auto"
        title={isEdit ? t('editTitle') : t('createTitle')}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              {isEdit ? t('editTitle') : t('createTitle')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('inBusiness', { name: business.name })}
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {TEXT_FIELDS.map((field) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`branch-${field}`}>
                {t(`fields.${field}`)}
                {field === 'name' ? (
                  <span className="text-destructive ms-1" aria-hidden>
                    *
                  </span>
                ) : null}
              </Label>
              {field === 'phone' ? (
                /* A branch inherits its business country. Use that country
                   for the example and validation; null keeps the international
                   fallback when the business has no country recorded. */
                <PhoneField
                  id="branch-phone"
                  value={values.phone ?? ''}
                  onChange={(next) => set('phone', next)}
                  country={business.country}
                />
              ) : (
                <Input
                  id={`branch-${field}`}
                  type="text"
                  placeholder={BRANCH_PLACEHOLDERS[field] ? tCommon(BRANCH_PLACEHOLDERS[field]) : undefined}
                  value={values[field] ?? ''}
                  onChange={(event) => set(field, event.target.value)}
                  aria-invalid={field === 'name' && nameError ? true : undefined}
                  aria-describedby={field === 'name' && nameError ? 'branch-name-error' : undefined}
                />
              )}
              {field === 'name' && nameError ? (
                <p id="branch-name-error" role="alert" className="text-destructive text-sm">
                  {nameError}
                </p>
              ) : null}
              {field === 'code' ? (
                <p className="text-muted-foreground text-xs">{t('codeHint')}</p>
              ) : null}
            </div>
          ))}

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="branch-selling"
                checked={isSellingPoint}
                onCheckedChange={(checked) => setIsSellingPoint(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="branch-selling">{t('fields.isSellingPoint')}</Label>
                <p className="text-muted-foreground text-xs">{t('sellingPointHint')}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="branch-default"
                checked={isDefault}
                onCheckedChange={(checked) => setIsDefault(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="branch-default">{t('fields.isDefault')}</Label>
                <p className="text-muted-foreground text-xs">{t('defaultHint')}</p>
              </div>
            </div>

            {isEdit ? (
              <div className="flex items-start gap-3">
                <Checkbox
                  id="branch-active"
                  checked={isActive}
                  onCheckedChange={(checked) => setIsActive(checked === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="branch-active">{t('fields.isActive')}</Label>
                  {/* Deactivating is not deleting: the branch's stock, orders
                      and history all survive and stay queryable. */}
                  <p className="text-muted-foreground text-xs">{t('activeHint')}</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void submit()} disabled={isSaving}>
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
