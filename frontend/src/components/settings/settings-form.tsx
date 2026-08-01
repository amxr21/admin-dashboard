'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, Palette, Settings2, SlidersHorizontal, Store, type LucideIcon } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchSettings,
  fieldErrorsFrom,
  saveSettings,
  type Setting,
} from '@/lib/settings-api';

/**
 * Key prefix → visual group, purely for layout. `settings.config.ts` on the
 * backend has no notion of groups — this is a hardcoded, presentation-only map
 * so a flat registry still reads as sections. A key matching none of these
 * still renders, under "other", so a future setting can't silently vanish.
 */
const GROUPS = [
  { id: 'brand', icon: Store, match: (key: string) => key.startsWith('store.') },
  {
    id: 'appearance',
    icon: Palette,
    match: (key: string) => key.startsWith('theme.') || key.startsWith('ui.'),
  },
  {
    id: 'notifications',
    icon: Bell,
    match: (key: string) => key.startsWith('notifications.'),
  },
  {
    id: 'operations',
    icon: SlidersHorizontal,
    match: (key: string) =>
      key.startsWith('inventory.') || key.startsWith('dashboard.') || key.startsWith('system.'),
  },
] as const;

type GroupId = (typeof GROUPS)[number]['id'] | 'other';

function groupByPrefix(
  settings: Setting[],
): { id: GroupId; icon: LucideIcon; items: Setting[] }[] {
  const buckets = new Map<GroupId, Setting[]>();

  for (const setting of settings) {
    const id: GroupId = GROUPS.find((group) => group.match(setting.key))?.id ?? 'other';
    const bucket = buckets.get(id);
    if (bucket) bucket.push(setting);
    else buckets.set(id, [setting]);
  }

  const known = GROUPS.map((group) => ({
    id: group.id as GroupId,
    icon: group.icon,
    items: buckets.get(group.id) ?? [],
  }));
  const other = buckets.get('other');

  return [...known, ...(other ? [{ id: 'other' as GroupId, icon: Settings2, items: other }] : [])].filter(
    (group) => group.items.length > 0,
  );
}

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

      <div className="divide-y">
        {groupByPrefix(settings).map((group, index) => (
          <div key={group.id} className={cn('space-y-4', index > 0 && 'pt-6')}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <group.icon className="text-muted-foreground size-4" aria-hidden="true" />
                <h3 className="text-sm font-semibold">{t(`groups.${group.id}.title`)}</h3>
              </div>
              <p className="text-muted-foreground text-sm">
                {t(`groups.${group.id}.description`)}
              </p>
            </div>

            <div className="space-y-5">
              {group.items.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={values[setting.key] ?? setting.value}
                  error={fieldErrors[setting.key]}
                  onChange={(value) => set(setting.key, value)}
                />
              ))}
            </div>
          </div>
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

      case 'color': {
        const isValidHex = /^#[0-9a-fA-F]{6}$/.test(String(value));

        return (
          <div className="flex items-center gap-2">
            {/* A live swatch, not a native color picker — this app avoids
                native interactive widgets (see project-ui-system) in favour
                of a plain validated text field, same as every other string
                setting. */}
            <span
              aria-hidden="true"
              className="border-border size-8 shrink-0 rounded-md border"
              style={{ backgroundColor: isValidHex ? String(value) : 'transparent' }}
            />
            <Input
              id={id}
              type="text"
              inputMode="text"
              value={String(value)}
              placeholder="#2563eb"
              maxLength={7}
              className="force-ltr font-mono"
              onChange={(event) => onChange(event.target.value)}
              {...aria}
            />
          </div>
        );
      }

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
