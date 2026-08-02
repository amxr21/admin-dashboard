'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from 'next-intl';
import { DayPicker } from 'react-day-picker';

import { cn } from '@/lib/utils';

/**
 * Month calendar.
 *
 * ─── WHY DIGITS ARE FORCED LATIN ─────────────────────────────────────
 * `Intl` renders Arabic dates in Arabic-Indic numerals (٢٠٢٦) by default. The
 * rest of this app pins `numberingSystem: 'latn'` — order numbers, prices and
 * table figures all read in Western digits in both languages, and a calendar
 * that disagreed would be the only screen where "7" and "٧" appear together.
 * So every formatter here goes through Intl explicitly rather than taking
 * react-day-picker's default.
 *
 * ─── WHY THE ARROWS ARE COMPUTED, NOT FIXED ──────────────────────────
 * "Previous month" points toward the reading start, which is LEFT in English
 * and RIGHT in Arabic. A hardcoded ChevronLeft would mean the Arabic calendar
 * has a back button pointing forward. `dir` is passed to DayPicker and the
 * chevron is chosen from the orientation it hands back, so the flip is the
 * library's decision rather than a guess made here.
 *
 * ─── WHY NOT A NATIVE DATE INPUT ─────────────────────────────────────
 * `<input type="date">` renders browser chrome that cannot be styled, ignores
 * the app's locale, and on Windows shows a picker in the OS language rather
 * than the page language.
 */

type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, numberingSystem: 'latn' });

  return (
    <DayPicker
      dir={dir}
      showOutsideDays={showOutsideDays}
      className={cn('w-fit', className)}
      formatters={{
        formatCaption: (month) => format({ month: 'long', year: 'numeric' }).format(month),
        formatWeekdayName: (day) => format({ weekday: 'short' }).format(day),
        formatDay: (day) => format({ day: 'numeric' }).format(day),
      }}
      components={{
        Chevron: ({ orientation, ...rest }) => {
          const Icon = orientation === 'left' ? ChevronLeft : ChevronRight;
          return <Icon className="size-4" aria-hidden {...rest} />;
        },
      }}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'space-y-3',
        month_caption: 'flex h-9 items-center justify-center',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center justify-between absolute start-0 end-0 h-9 px-1',
        button_previous: cn(
          'inline-flex size-7 items-center justify-center rounded-md',
          // Same convention as select.tsx — primary-tinted, not amber.
          'text-muted-foreground hover:text-primary hover:bg-primary/10',
          'transition-colors duration-200 disabled:opacity-30',
        ),
        button_next: cn(
          'inline-flex size-7 items-center justify-center rounded-md',
          'text-muted-foreground hover:text-primary hover:bg-primary/10',
          'transition-colors duration-200 disabled:opacity-30',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground w-9 text-[0.8rem] font-normal',
        week: 'flex w-full mt-1',
        day: 'size-9 p-0',
        day_button: cn(
          'size-9 rounded-md text-sm font-normal transition-colors duration-200',
          'hover:bg-primary/10 hover:text-primary',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-40',
        ),
        selected: cn(
          '[&>button]:bg-primary [&>button]:text-primary-foreground',
          '[&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        ),
        // An outline rather than a fill, so "today" never looks selected.
        today: '[&>button]:ring-primary/40 [&>button]:ring-1',
        outside: 'text-muted-foreground/50',
        disabled: 'text-muted-foreground/40',
        hidden: 'invisible',
        ...classNames,
      }}
      {...props}
    />
  );
}
