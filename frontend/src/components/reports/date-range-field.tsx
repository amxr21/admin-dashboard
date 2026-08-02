'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar as CalendarIcon, Check } from 'lucide-react';

import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  presetForRange,
  rangeForPreset,
  type DateRange,
  type RangePreset,
} from '@/lib/reports-api';

/**
 * The from/to date-range control, extracted so Reports and the Dashboard
 * share one implementation instead of two copies that could drift — Reports
 * had this built inline; the Dashboard gained the same need when it stopped
 * being locked to a fixed 30-day window.
 */
interface DateRangeFieldProps {
  range: DateRange;
  onChange: (range: DateRange) => void;
  idPrefix: string;
  /** Compact one-line layout: the two pickers sit side by side with a dash
   *  between them and the "From"/"To" labels go visually hidden (kept for
   *  assistive tech). Used by the dashboard control band, where a full labelled
   *  two-column block would cost the vertical space this exists to reclaim.
   *  Reports keeps the default labelled layout. */
  inline?: boolean;
}

export function DateRangeField({ range, onChange, idPrefix, inline }: DateRangeFieldProps) {
  const t = useTranslations('reports');

  if (inline) {
    return (
      <div className="flex items-center gap-2">
        <Label htmlFor={`${idPrefix}-from`} className="sr-only">
          {t('from')}
        </Label>
        <DatePicker
          id={`${idPrefix}-from`}
          value={range.from}
          required
          onChange={(value) => value && onChange({ ...range, from: value })}
        />
        <span className="text-muted-foreground" aria-hidden="true">
          –
        </span>
        <Label htmlFor={`${idPrefix}-to`} className="sr-only">
          {t('to')}
        </Label>
        <DatePicker
          id={`${idPrefix}-to`}
          value={range.to}
          required
          onChange={(value) => value && onChange({ ...range, to: value })}
        />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-from`}>{t('from')}</Label>
        <DatePicker
          id={`${idPrefix}-from`}
          value={range.from}
          required
          onChange={(value) => value && onChange({ ...range, from: value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-to`}>{t('to')}</Label>
        <DatePicker
          id={`${idPrefix}-to`}
          value={range.to}
          required
          onChange={(value) => value && onChange({ ...range, to: value })}
        />
      </div>
    </>
  );
}

const PRESET_ORDER: Exclude<RangePreset, 'custom'>[] = ['today', '7d', '30d', 'mtd', 'qtd'];

/** `RangePreset` values are machine keys; this is the only place that maps
 *  them to the `reports.presets.*` translation keys, so the two vocabularies
 *  (route/state value vs. display label) can't quietly drift apart. */
const PRESET_LABEL_KEY: Record<Exclude<RangePreset, 'custom'>, string> = {
  today: 'today',
  '7d': 'last7Days',
  '30d': 'last30Days',
  mtd: 'monthToDate',
  qtd: 'quarterToDate',
};

/**
 * The dashboard's date-range control (checklist Phase 2.10-2.12): one
 * trigger showing the active preset, opening a popover with every preset as
 * a single-click row plus a "Custom" row that reveals the original two date
 * pickers — no capability lost, just not permanently on screen for the
 * common case of picking a preset.
 */
export function DateRangePresetField({
  range,
  onChange,
  idPrefix,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
  idPrefix: string;
}) {
  const t = useTranslations('reports');
  const [open, setOpen] = useState(false);

  const activePreset = presetForRange(range);
  // Starts expanded when the CURRENT range doesn't match any preset (e.g. a
  // range restored from a link) — Custom should show what's actually active,
  // not silently hide it behind a "Custom" label with no visible dates.
  const [customExpanded, setCustomExpanded] = useState(activePreset === null);

  // A preset picked from OUTSIDE (e.g. Reset elsewhere) should collapse the
  // custom picker back — otherwise it could sit open showing a stale range.
  useEffect(() => {
    if (activePreset !== null) setCustomExpanded(false);
  }, [activePreset]);

  const label = activePreset ? t(`presets.${PRESET_LABEL_KEY[activePreset]}`) : t('presets.custom');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <CalendarIcon className="size-3.5" aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div role="listbox" aria-label={label}>
          {PRESET_ORDER.map((preset) => {
            const isActive = activePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(rangeForPreset(preset));
                  setCustomExpanded(false);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-start text-sm',
                  isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                )}
              >
                {t(`presets.${PRESET_LABEL_KEY[preset]}`)}
                {isActive ? <Check className="size-3.5" aria-hidden /> : null}
              </button>
            );
          })}

          <button
            type="button"
            role="option"
            aria-selected={activePreset === null}
            onClick={() => setCustomExpanded(true)}
            className={cn(
              'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-start text-sm',
              activePreset === null ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
            )}
          >
            {t('presets.custom')}
            {activePreset === null ? <Check className="size-3.5" aria-hidden /> : null}
          </button>
        </div>

        {customExpanded ? (
          <div className="mt-2 space-y-2 border-t pt-2">
            <DateRangeField range={range} onChange={onChange} idPrefix={idPrefix} inline />
            <Button size="sm" className="w-full" onClick={() => setOpen(false)}>
              {t('presets.apply')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
