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
  /**
   * Lets either end be CLEARED back to empty.
   *
   * Off by default, which is right for every reports/dashboard consumer: those
   * always hold a real range (a preset, or a custom one the user picked), and
   * an empty bound there would mean "no data window" for a view that cannot
   * render without one — which is exactly why `DatePicker` hides its clear
   * control and ignores a deselect when `required`.
   *
   * The export centre is the opposite case: its range is genuinely optional
   * ("export everything" is the default), so without this a person who picked
   * a date by mistake could never unpick it and would be stuck exporting a
   * window they did not want.
   */
  optional?: boolean;
}

export function DateRangeField({
  range,
  onChange,
  idPrefix,
  inline,
  optional,
}: DateRangeFieldProps) {
  const t = useTranslations('reports');
  // `required` is the DatePicker's own prop name and the inverse of this one;
  // naming the prop `optional` here keeps the opt-in reading correctly at the
  // call site ("this range may be empty") rather than as a double negative.
  const required = !optional;

  /**
   * The `value &&` guard below drops an empty string, which is what the
   * REQUIRED consumers need — `DatePicker` emits `''` when a picked day is
   * clicked again, and a reports view cannot render with half a range.
   *
   * An optional range wants the opposite: clearing is a real choice, and
   * swallowing it would leave the newly visible clear button doing nothing.
   */
  const commit = (next: DateRange) => {
    if (!optional && (next.from === '' || next.to === '')) return;
    onChange(next);
  };

  if (inline) {
    return (
      <div className="flex items-center gap-2">
        <Label htmlFor={`${idPrefix}-from`} className="sr-only">
          {t('from')}
        </Label>
        <DatePicker
          id={`${idPrefix}-from`}
          value={range.from}
          required={required}
          onChange={(value) => commit({ ...range, from: value })}
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
          required={required}
          onChange={(value) => commit({ ...range, to: value })}
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
          required={required}
          onChange={(value) => commit({ ...range, from: value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-to`}>{t('to')}</Label>
        <DatePicker
          id={`${idPrefix}-to`}
          value={range.to}
          required={required}
          onChange={(value) => commit({ ...range, to: value })}
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
