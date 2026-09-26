'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Setting } from '@/lib/settings-api';

/**
 * The wizard's Look & feel step: the store-wide appearance an owner would
 * otherwise only find deep in Settings. Same keys and the same server-side
 * option lists as the settings form, so nothing here can offer a value the
 * server would refuse. Changes preview live and are saved with the wizard.
 */

export const LOOK_KEYS = ['theme.accentColor', 'theme.fontFamily', 'ui.cornerRadius'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];
export type LookDraft = Partial<Record<LookKey, string>>;

interface SetupLookProps {
  settings: Setting[];
  value: LookDraft;
  onChange: (key: LookKey, value: string) => void;
}

export function SetupLook({ settings, value, onChange }: SetupLookProps) {
  const t = useTranslations('setup.look');
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  const current = (key: LookKey) => value[key] ?? String(byKey.get(key)?.value ?? '');

  const accent = byKey.get('theme.accentColor');
  const font = byKey.get('theme.fontFamily');
  const radius = byKey.get('ui.cornerRadius');

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">{t('intro')}</p>

      {accent ? (
        <div className="space-y-2">
          <p id="look-accent-label" className="text-sm font-medium">{t('accent')}</p>
          <div role="radiogroup" aria-labelledby="look-accent-label" className="flex flex-wrap gap-2">
            {(accent.options ?? []).map((option) => {
              const selected = current('theme.accentColor').toLowerCase() === option.toLowerCase();
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option}
                  onClick={() => onChange('theme.accentColor', option)}
                  className={cn(
                    'flex size-11 items-center justify-center rounded-full border-2 transition',
                    selected ? 'border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: option }}
                >
                  {selected ? <Check className="size-5 text-white" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {font ? (
        <ChoiceGroup
          id="look-font"
          label={t('font')}
          options={font.options ?? []}
          value={current('theme.fontFamily')}
          optionLabel={(option) => t(`fonts.${option}`)}
          optionStyle={(option) => ({ fontFamily: `var(--font-latin-${option}), var(--font-arabic-${option})` })}
          onChange={(option) => onChange('theme.fontFamily', option)}
        />
      ) : null}

      {radius ? (
        <ChoiceGroup
          id="look-radius"
          label={t('corners')}
          options={radius.options ?? []}
          value={current('ui.cornerRadius')}
          optionLabel={(option) => t(`radius.${option}`)}
          onChange={(option) => onChange('ui.cornerRadius', option)}
        />
      ) : null}

      <p className="text-muted-foreground text-sm">{t('later')}</p>
    </div>
  );
}

function ChoiceGroup({
  id,
  label,
  options,
  value,
  optionLabel,
  optionStyle,
  onChange,
}: {
  id: string;
  label: string;
  options: string[];
  value: string;
  optionLabel: (option: string) => string;
  optionStyle?: (option: string) => CSSProperties;
  onChange: (option: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label id={`${id}-label`}>{label}</Label>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="grid gap-2 sm:grid-cols-4">
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={cn(
                'bg-card min-h-11 rounded-md border px-3 py-2 text-start text-sm transition',
                selected ? 'border-primary ring-primary/30 ring-2' : 'hover:bg-muted/50',
              )}
              style={optionStyle?.(option)}
            >
              {optionLabel(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
