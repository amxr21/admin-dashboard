'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ErrorScreen } from '@/components/errors/error-screen';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  fetchSettings,
  fieldErrorsFrom,
  saveSettings,
  type Setting,
} from '@/lib/settings-api';

/**
 * Store settings, rendered from the server's registry.
 *
 * ─── NOTHING HERE KNOWS WHAT THE SETTINGS ARE ────────────────────────
 * Each item arrives with its own type, label, options and bounds. There is no
 * local list to keep in step, so adding a setting in `settings.config.ts` makes
 * it appear with no change to this file.
 *
 * ─── SAVES THE WHOLE FORM AT ONCE ────────────────────────────────────
 * The server validates every key before writing any, so a rejected value
 * leaves nothing persisted. Saving key-by-key would produce the half-saved
 * form that behaviour exists to prevent — and a per-field save control would
 * quietly reintroduce it.
 */

type Value = string | boolean | number;

export function SettingsForm() {
  const t = useTranslations('settings');
  const translateError = useTranslatedApiError();

  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setValues(Object.fromEntries(loaded.map((s) => [s.key, s.value])));
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
  }, [translateError]);

  function set(key: string, value: Value) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  /** Only what actually differs — an unchanged form sends nothing. */
  function changes(): Record<string, Value> {
    if (!settings) return {};

    return Object.fromEntries(
      settings
        .filter((setting) => values[setting.key] !== setting.value)
        .map((setting) => [setting.key, values[setting.key] as Value]),
    );
  }

  async function submit() {
    const payload = changes();

    if (Object.keys(payload).length === 0) {
      // Nothing to send. The API rejects an empty PATCH, so saying "no changes"
      // beats showing an error for doing nothing wrong.
      setSaved(true);
      return;
    }

    setIsSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const updated = await saveSettings(payload);
      setSettings(updated);
      setValues(Object.fromEntries(updated.map((s) => [s.key, s.value])));
      setSaved(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        // The server reports EVERY bad key at once, so all of them land on
        // their own control rather than one banner naming the first.
        const fields = fieldErrorsFrom(caught.details);

        if (Object.keys(fields).length > 0) {
          setFieldErrors(fields);
        } else {
          setError(caught.message);
        }
      } else {
        setError(translateError(caught));
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!settings) {
    return (
      <ErrorScreen
        title={t('loadFailed')}
        description={error ?? t('loadFailed')}
        onRetry={() => window.location.reload()}
      />
    );
  }

  const isDirty = Object.keys(changes()).length > 0;

  return (
    <div className="space-y-6">
      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-5">
        {settings.map((setting) => (
          <SettingField
            key={setting.key}
            setting={setting}
            value={values[setting.key] ?? setting.value}
            error={fieldErrors[setting.key]}
            onChange={(value) => set(setting.key, value)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button disabled={isSaving || !isDirty} onClick={() => void submit()}>
          {isSaving ? t('saving') : t('save')}
        </Button>

        {saved && !isDirty ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t('saved')}
          </p>
        ) : null}

        {isDirty ? (
          // Named count, so it is obvious something is pending rather than the
          // button simply being enabled for no visible reason.
          <p className="text-muted-foreground text-sm">
            {t('unsaved', { count: Object.keys(changes()).length })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface SettingFieldProps {
  setting: Setting;
  value: Value;
  error: string | undefined;
  onChange: (value: Value) => void;
}

/** One control, chosen by the type the SERVER declared. */
function SettingField({ setting, value, error, onChange }: SettingFieldProps) {
  // Only the language namespace is needed here — every other label and
  // description comes from the server's registry, already human-readable.
  const tLanguage = useTranslations('language');
  const id = `setting-${setting.key}`;
  const errorId = `${id}-error`;

  const aria = {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : `${id}-hint`,
  } as const;

  function control() {
    switch (setting.type) {
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={Boolean(value)}
              onCheckedChange={(checked) => onChange(checked === true)}
              {...aria}
            />
            <Label htmlFor={id}>{setting.label}</Label>
          </div>
        );

      case 'enum':
        return (
          <Select value={String(value)} onValueChange={onChange}>
            <SelectTrigger id={id} {...aria}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(setting.options ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {/* Locale codes get a readable name from the EXISTING
                      `language` namespace — not a second copy under
                      `settings`. Language names are endonyms ("English"
                      stays "English" in Arabic), so a duplicate pair would
                      be flagged as untranslated forever and would drift the
                      moment someone edited one of them.

                      Everything else is already human-readable (currency
                      codes, etc). */}
                  {setting.key === 'ui.defaultLocale' && tLanguage.has(option)
                    ? tLanguage(option)
                    : option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'number':
        return (
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            value={String(value)}
            min={setting.min}
            max={setting.max}
            onChange={(event) => {
              const next = Number(event.target.value);
              // Guarded so an empty field does not become NaN, which the API
              // would reject with a message about the wrong thing.
              onChange(Number.isFinite(next) ? next : 0);
            }}
            {...aria}
          />
        );

      default:
        return (
          <Input
            id={id}
            type="text"
            value={String(value)}
            maxLength={setting.max}
            onChange={(event) => onChange(event.target.value)}
            {...aria}
          />
        );
    }
  }

  return (
    <div className="space-y-2">
      {setting.type === 'boolean' ? null : (
        <Label htmlFor={id}>{setting.label}</Label>
      )}

      {control()}

      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : setting.description ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {setting.description}
        </p>
      ) : null}
    </div>
  );
}
