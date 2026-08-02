'use client';

import { useTranslations } from 'next-intl';

import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import type { DateRange } from '@/lib/reports-api';

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
