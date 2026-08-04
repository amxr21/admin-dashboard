'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProductGalleryPanel } from '@/components/resource/product-gallery-panel';
import { ProductVariantsPanel } from '@/components/resource/product-variants-panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { isEmailShaped } from '@/lib/email';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  createRow,
  fetchRelationOptions,
  formFields,
  updateRow,
  type FieldConfig,
  type ResourceRow,
  type ResourceSchema,
} from '@/lib/resource-api';

/**
 * One form for every resource, rendered from its schema.
 *
 * ─── VALIDATION MIRRORS THE SERVER, IT DOESN'T REPLACE IT ────────────
 * Every rule checked here is also checked in resource.service.ts, and the
 * server's copy is the one that counts — this one exists so the user finds out
 * before a round trip, not so the server can trust the client. Where the two
 * could drift, the regexes are copied verbatim rather than reimplemented.
 *
 * ─── MONEY IS A STRING, START TO FINISH ──────────────────────────────
 * `price` is Decimal(10,2). A JSON number loses precision inside JSON.parse,
 * upstream of anything either side can check, so the value is typed as text,
 * held as text, validated as text and sent as text. The only permitted
 * `Number()` on a money value anywhere in this app is display formatting.
 */

/** Copied verbatim from coerceWriteValue() in resource.service.ts. */
const MONEY_PATTERN = /^-?\d{1,8}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Email is NOT a regex on either side — the old pattern was a polynomial
// ReDoS. See lib/email.ts, which mirrors the backend's copy.

/**
 * Sentinel for "no selection" in a Select.
 *
 * Radix treats `value=""` as unset and refuses it on an item, so clearing an
 * optional enum or relation needs a value that is not the empty string. It is
 * mapped back to '' before it reaches state, so nothing downstream ever sees it.
 */
const NONE = '__none__';

type FormValue = string | boolean;
type FormValues = Record<string, FormValue>;

interface RelationOption {
  value: string;
  label: string;
}

interface ResourceFormProps {
  schema: ResourceSchema;
  /** null opens an empty form for a create; a row opens it for an edit. */
  row: ResourceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (action: 'created' | 'updated') => void;
}

/**
 * Row value to form value.
 *
 * Everything becomes a string except booleans, so one uniform model covers
 * every control and the conversion back to typed JSON happens in exactly one
 * place (`toPayload`) rather than scattered through onChange handlers.
 */
function toFormValue(field: FieldConfig, row: ResourceRow | null): FormValue {
  if (field.type === 'boolean') return Boolean(row?.[field.name] ?? false);

  const raw = row?.[field.name];
  if (raw === null || raw === undefined) return '';

  // The API sends ISO; the control edits the date part only. Slicing rather
  // than constructing a Date avoids shifting the day across a timezone.
  if (field.type === 'datetime' || field.type === 'date') {
    return String(raw).slice(0, 10);
  }

  return String(raw);
}

function initialValues(schema: ResourceSchema, row: ResourceRow | null): FormValues {
  return Object.fromEntries(
    formFields(schema).map((field) => [field.name, toFormValue(field, row)]),
  );
}

/** Form value back to the JSON type the engine expects for this field. */
function toPayloadValue(field: FieldConfig, value: FormValue): unknown {
  if (field.type === 'boolean') return Boolean(value);

  const text = String(value).trim();

  // The server maps null to "unset" for optional fields, and rejects it for
  // required ones — which is the behaviour we want in both cases.
  if (text === '') return null;

  switch (field.type) {
    case 'number':
      // `number` must arrive as a JSON number; a numeric string is a 400.
      return Number(text);
    case 'datetime':
    case 'date':
      return new Date(`${text}T00:00:00.000Z`).toISOString();
    default:
      // money included: deliberately still a string.
      return text;
  }
}

export function ResourceForm({
  schema,
  row,
  open,
  onOpenChange,
  onSaved,
}: ResourceFormProps) {
  const t = useTranslations('resourceForm');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const fields = useMemo(() => formFields(schema), [schema]);
  const isEdit = row !== null;

  const [values, setValues] = useState<FormValues>(() => initialValues(schema, row));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Variants/gallery are a product's own sub-records, not generic-engine
  // fields — managed through their own bespoke panels, opened from this
  // form rather than nested inside it, so this stays the one place a
  // conditional `schema.resource === 'products'` check exists.
  const [variantsPanelOpen, setVariantsPanelOpen] = useState(false);
  const [galleryPanelOpen, setGalleryPanelOpen] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [relationOptions, setRelationOptions] = useState<
    Record<string, RelationOption[]>
  >({});

  // Reset when the sheet opens onto a different row, so an edit never inherits
  // the previous row's values or its error messages.
  useEffect(() => {
    if (!open) return;

    setValues(initialValues(schema, row));
    setFieldErrors({});
    setFormError(null);
    setIsDirty(false);
    setIsConfirmingDiscard(false);
  }, [open, schema, row]);

  // Relation pickers need their options before they can render a label.
  useEffect(() => {
    if (!open) return;

    const relations = fields.filter((field) => field.type === 'relation');
    if (relations.length === 0) return;

    let cancelled = false;

    void Promise.all(
      relations.map(async (field) => {
        const options = await fetchRelationOptions(schema.resource, field.name).catch(
          // A relation that won't load must not take the whole form down — the
          // field renders empty and its own required check still applies.
          () => [] as RelationOption[],
        );
        return [field.name, options] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setRelationOptions(Object.fromEntries(entries));
      })
      // The per-field catch above already covers a failed request; this covers
      // the settle itself. An unhandled rejection here would surface as a
      // process-level warning with no connection to this form.
      .catch(() => {
        if (!cancelled) setRelationOptions({});
      });

    return () => {
      cancelled = true;
    };
  }, [open, schema.resource, fields]);

  const setValue = useCallback((name: string, value: FormValue) => {
    setValues((current) => ({ ...current, [name]: value }));
    setIsDirty(true);
    // Clear this field's error as soon as it's touched: a message that stays
    // put while the user fixes the problem reads as "still wrong".
    setFieldErrors((current) => {
      if (!(name in current)) return current;
      const { [name]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  /** Returns a message when the value is wrong, null when it's acceptable. */
  const validateField = useCallback(
    (field: FieldConfig, value: FormValue): string | null => {
      if (field.type === 'boolean') return null;

      const text = String(value).trim();

      if (text === '') {
        return field.required ? t('errors.required') : null;
      }

      switch (field.type) {
        case 'money':
          return MONEY_PATTERN.test(text) ? null : t('errors.money');
        case 'number':
          return Number.isFinite(Number(text)) ? null : t('errors.number');
        case 'date':
        case 'datetime':
          return DATE_PATTERN.test(text) && !Number.isNaN(Date.parse(text))
            ? null
            : t('errors.date');
        case 'email':
          return isEmailShaped(text) ? null : t('errors.email');
        case 'enum':
          return field.options?.includes(text) ? null : t('errors.enum');
        default:
          return null;
      }
    },
    [t],
  );

  function buildPayload(): ResourceRow {
    const payload: ResourceRow = {};

    for (const field of fields) {
      const value = values[field.name] ?? '';

      // On edit, send only what changed. It keeps the audit surface small, and
      // the engine rejects an empty PATCH — so an unchanged form closing
      // silently is better than a confusing 400.
      if (isEdit && value === toFormValue(field, row)) continue;

      payload[field.name] = toPayloadValue(field, value);
    }

    return payload;
  }

  /**
   * Maps an API failure onto the field that caused it.
   *
   * The engine reports `{ field }` on a validation failure and `{ fields }` on
   * a uniqueness conflict. Attaching the message to the input beats a banner
   * at the top of a long form, where the user has to work out which row it
   * refers to.
   */
  function applyApiError(caught: unknown) {
    if (!(caught instanceof ApiError)) {
      setFormError(translateError(caught));
      return;
    }

    const details = caught.details;
    const named: string[] = [];

    if (details && typeof details === 'object') {
      const single = (details as { field?: unknown }).field;
      const many = (details as { fields?: unknown }).fields;

      if (typeof single === 'string') named.push(single);
      if (Array.isArray(many)) {
        named.push(...many.filter((entry): entry is string => typeof entry === 'string'));
      }
    }

    const known = named.filter((name) => fields.some((field) => field.name === name));

    if (known.length === 0) {
      setFormError(translateError(caught));
      return;
    }

    // 409 is the one the client cannot predict, so it gets its own translated
    // message. Other statuses fall back to the server's text, which already
    // names the field in a sentence.
    const message = caught.status === 409 ? t('errors.duplicate') : caught.message;
    setFieldErrors(Object.fromEntries(known.map((name) => [name, message])));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors: Record<string, string> = {};
    for (const field of fields) {
      const message = validateField(field, values[field.name] ?? '');
      if (message) errors[field.name] = message;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(null);
      return;
    }

    const payload = buildPayload();

    if (isEdit && Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      if (isEdit) {
        await updateRow(schema.resource, String(row.id), payload);
      } else {
        await createRow(schema.resource, payload);
      }

      setIsDirty(false);
      onSaved(isEdit ? 'updated' : 'created');
      onOpenChange(false);
    } catch (caught) {
      applyApiError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  /** Closing with unsaved edits asks first rather than discarding silently. */
  function requestClose(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }

    if (isDirty && !isSaving) {
      setIsConfirmingDiscard(true);
      return;
    }

    onOpenChange(false);
  }

  return (
    <>
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-lg overflow-y-auto"
        title={isEdit ? t('editTitle', { label: schema.label }) : t('createTitle', { label: schema.label })}
        // Escape and outside clicks route through the same guard as the
        // buttons, so there is no way to lose edits by accident.
        onEscapeKeyDown={(event) => {
          if (isDirty) {
            event.preventDefault();
            setIsConfirmingDiscard(true);
          }
        }}
        onInteractOutside={(event) => {
          if (isDirty) {
            event.preventDefault();
            setIsConfirmingDiscard(true);
          }
        }}
      >
        <form onSubmit={(event) => void handleSubmit(event)} className="flex h-full flex-col gap-4">
          <h2 className="text-lg font-semibold">
            {isEdit
              ? t('editTitle', { label: schema.label })
              : t('createTitle', { label: schema.label })}
          </h2>

          {formError ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex-1 space-y-4">
            {fields.map((field) => (
              <FormField
                key={field.name}
                field={field}
                value={values[field.name] ?? ''}
                error={fieldErrors[field.name]}
                options={relationOptions[field.name] ?? []}
                onChange={(value) => setValue(field.name, value)}
              />
            ))}

            {isEdit && schema.resource === 'products' ? (
              <div className="flex gap-2 border-t pt-4">
                <Button type="button" variant="outline" size="sm" onClick={() => setVariantsPanelOpen(true)}>
                  {t('manageVariants')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setGalleryPanelOpen(true)}>
                  {t('manageGallery')}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => requestClose(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </form>
      </SheetContent>

      <AlertDialog
        open={isConfirmingDiscard}
        onOpenChange={(next) => {
          if (!next) setIsConfirmingDiscard(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discard.title')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsConfirmingDiscard(false)}>
              {t('discard.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsConfirmingDiscard(false);
                setIsDirty(false);
                onOpenChange(false);
              }}
            >
              {t('discard.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>

    {isEdit && schema.resource === 'products' ? (
      <>
        <ProductVariantsPanel
          productId={String(row.id)}
          productName={String(row.name ?? '')}
          open={variantsPanelOpen}
          onOpenChange={setVariantsPanelOpen}
        />
        <ProductGalleryPanel
          productId={String(row.id)}
          productName={String(row.name ?? '')}
          open={galleryPanelOpen}
          onOpenChange={setGalleryPanelOpen}
        />
      </>
    ) : null}
    </>
  );
}

interface FormFieldProps {
  field: FieldConfig;
  value: FormValue;
  error: string | undefined;
  options: RelationOption[];
  onChange: (value: FormValue) => void;
}

/** One labelled control, chosen by the field's SEMANTIC type. */
function FormField({ field, value, error, options, onChange }: FormFieldProps) {
  const t = useTranslations('resourceForm');
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;

  // aria-describedby only when there IS a message — pointing at an element
  // that doesn't exist makes some screen readers announce nothing at all.
  const aria = {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
  } as const;

  function control() {
    if (field.type === 'boolean') {
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked === true)}
            {...aria}
          />
          <Label htmlFor={id}>{field.label}</Label>
        </div>
      );
    }

    const text = String(value);

    if (field.type === 'enum' || field.type === 'relation') {
      const items =
        field.type === 'enum'
          ? (field.options ?? []).map((option) => ({ value: option, label: option }))
          : options;

      return (
        <Select
          // Radix reserves the empty string for "no selection", so an explicit
          // clear needs a sentinel of its own. Without one, an optional enum
          // or relation could be SET but never unset — the only way back to
          // empty would be a direct API call.
          value={text === '' ? NONE : text}
          onValueChange={(next) => onChange(next === NONE ? '' : next)}
        >
          <SelectTrigger id={id} {...aria}>
            <SelectValue placeholder={t('choose')} />
          </SelectTrigger>
          <SelectContent>
            {field.required ? null : (
              <SelectItem value={NONE}>{t('none')}</SelectItem>
            )}
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (field.type === 'date' || field.type === 'datetime') {
      return (
        <DatePicker
          id={id}
          value={text}
          onChange={onChange}
          required={field.required}
          {...aria}
        />
      );
    }

    if (field.type === 'longtext') {
      return (
        <Textarea
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          {...aria}
        />
      );
    }

    return (
      <Input
        id={id}
        // Passing a REAL type matters: globals.css forces email/tel/url inputs
        // to render LTR by selector, which never fires on a bare text input.
        type={inputType(field)}
        // Money is text, never `type="number"` — a number input would let the
        // browser hand back a float and undo the whole string discipline.
        inputMode={field.type === 'money' ? 'decimal' : undefined}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholderFor(field)}
        {...aria}
      />
    );
  }

  return (
    <div className="space-y-2">
      {field.type === 'boolean' ? null : (
        <Label htmlFor={id}>
          {field.label}
          {field.required ? (
            <span className="text-destructive ms-1" aria-hidden>
              *
            </span>
          ) : null}
        </Label>
      )}

      {control()}

      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function inputType(field: FieldConfig): string {
  switch (field.type) {
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'url':
    case 'image':
      return 'url';
    case 'number':
      return 'number';
    default:
      // money is text on purpose; dates never reach here (DatePicker handles
      // them) so there is no `type="date"` anywhere in the app.
      return 'text';
  }
}

function placeholderFor(field: FieldConfig): string | undefined {
  if (field.type === 'money') return '0.00';
  return undefined;
}
