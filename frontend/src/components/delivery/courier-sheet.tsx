'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  COURIER_STATUSES,
  createCourier,
  updateCourier,
  type Courier,
  type CourierInput,
  type CourierStatus,
} from '@/lib/delivery-api';

/**
 * Create or edit a courier.
 *
 * Hand-written rather than the generic resource form, because couriers are not
 * a configured resource — they carry a credential, so the engine deliberately
 * cannot reach them.
 *
 * Note what is NOT here: the access code. Issuing one is a separate, explicit
 * action from the list, so saving a phone number can never rotate a credential
 * as a side effect.
 */

interface CourierSheetProps {
  courier: Courier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}

type Values = Record<string, string>;

const TEXT_FIELDS = [
  'name',
  'phone',
  'email',
  'vehicleType',
  'plateNumber',
  'zone',
  'region',
  'country',
] as const;

function initial(courier: Courier | null): Values {
  return Object.fromEntries([
    ...TEXT_FIELDS.map((field) => [field, courier?.[field] ?? '']),
    ['status', courier?.status ?? 'ACTIVE'],
  ]) as Values;
}

export function CourierSheet({ courier, open, onOpenChange, onSaved }: CourierSheetProps) {
  const t = useTranslations('delivery.form');
  const tStatus = useTranslations('deliveryStaffStatus');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [values, setValues] = useState<Values>(() => initial(courier));
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEdit = courier !== null;

  useEffect(() => {
    if (!open) return;
    setValues(initial(courier));
    setError(null);
    setNameError(null);
  }, [open, courier]);

  function set(field: string, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === 'name') setNameError(null);
  }

  /** Empty optional strings are dropped, not sent blank. */
  function payload(): CourierInput {
    const out: Record<string, string> = {};

    for (const field of TEXT_FIELDS) {
      const value = (values[field] ?? '').trim();
      if (value) out[field] = value;
    }

    out.status = values.status ?? 'ACTIVE';

    return out as unknown as CourierInput;
  }

  async function submit() {
    if (!(values.name ?? '').trim()) {
      setNameError(t('nameRequired'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const saved = isEdit
        ? await updateCourier(courier.id, payload())
        : await createCourier(payload());

      onSaved(t(isEdit ? 'updated' : 'created', { name: saved.name }));
      onOpenChange(false);
    } catch (caught) {
      // The API's 400 names the field; keep it rather than flattening.
      setError(
        caught instanceof ApiError && caught.status === 400
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
        className="w-full max-w-md overflow-y-auto"
        title={isEdit ? t('editTitle') : t('createTitle')}
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {isEdit ? t('editTitle') : t('createTitle')}
          </h2>

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
              <Label htmlFor={`courier-${field}`}>
                {t(`fields.${field}`)}
                {field === 'name' ? (
                  <span className="text-destructive ms-1" aria-hidden>
                    *
                  </span>
                ) : null}
              </Label>
              <Input
                id={`courier-${field}`}
                // Real types so globals.css can force LTR on codes and contacts.
                type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                value={values[field] ?? ''}
                onChange={(event) => set(field, event.target.value)}
                aria-invalid={field === 'name' && nameError ? true : undefined}
                aria-describedby={field === 'name' && nameError ? 'courier-name-error' : undefined}
              />
              {field === 'name' && nameError ? (
                <p id="courier-name-error" role="alert" className="text-destructive text-sm">
                  {nameError}
                </p>
              ) : null}
            </div>
          ))}

          <div className="space-y-2">
            <Label htmlFor="courier-status">{t('fields.status')}</Label>
            <Select
              value={values.status ?? 'ACTIVE'}
              onValueChange={(value) => set('status', value as CourierStatus)}
            >
              <SelectTrigger id="courier-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COURIER_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {tStatus(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {values.status === 'INACTIVE' ? (
              // Deactivating does not revoke the code — that is a separate,
              // deliberate action. Saying so avoids assuming it did.
              <p className="text-muted-foreground text-sm">{t('inactiveNote')}</p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={isSaving} onClick={() => void submit()}>
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
