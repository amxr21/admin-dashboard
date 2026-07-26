'use client';

import { CalendarIcon, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Date field. Picked from a calendar, never typed.
 *
 * ─── THE VALUE IS A 'YYYY-MM-DD' STRING, NOT A Date ──────────────────
 * That is what the form model holds and what the API expects, so the Date
 * object exists only for the duration of a click. Storing a Date in form state
 * would mean every comparison, every "did this change" check and every
 * serialisation had to agree on a timezone.
 *
 * ─── WHY THE CONVERSION IS HAND-ROLLED ───────────────────────────────
 * `toISOString()` converts to UTC first. West of Greenwich that turns the 27th
 * into the 26th, so a user picks a date and the form saves the day before —
 * silently, and only for some users, which is the worst kind of bug to chase.
 * Reading the local Y/M/D parts has no timezone in it at all.
 */

interface DatePickerProps {
  id?: string;
  /** ISO calendar date, `YYYY-MM-DD`. Empty string means unset. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
}

/** Local date parts — never `toISOString`, which shifts the day. */
function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parsed as LOCAL midnight, matching how it is written back out. */
function fromIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  // Rejects the 31st of February rather than silently rolling it to March.
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function DatePicker({
  id,
  value,
  onChange,
  required,
  'aria-invalid': ariaInvalid,
  'aria-describedby': describedBy,
}: DatePickerProps) {
  const t = useTranslations('datePicker');
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const selected = fromIsoDate(value);

  const label = selected
    ? new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        numberingSystem: 'latn',
      }).format(selected)
    : t('choose');

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={ariaInvalid}
            aria-describedby={describedBy}
            className={cn(
              'w-full justify-start font-normal',
              !selected && 'text-muted-foreground',
            )}
          >
            <CalendarIcon aria-hidden />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            autoFocus
            onSelect={(date) => {
              // Undefined means the selected day was clicked again. For a
              // required field that would leave it empty with no way to tell
              // the difference from never having chosen, so it is ignored.
              if (!date) {
                if (!required) onChange('');
                setOpen(false);
                return;
              }

              onChange(toIsoDate(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {/* Clearing is its own control rather than a "None" row in the calendar,
          which would sit oddly among the days. Hidden when required, since
          there is nothing valid to clear to. */}
      {selected && !required ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('clear')}
          onClick={() => onChange('')}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
