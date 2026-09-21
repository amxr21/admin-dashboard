import { AppError } from '../errors/AppError.js';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseDateOnly(value: string, field: string): CalendarDate {
  const match = DATE_ONLY.exec(value);
  if (!match) throw AppError.badRequest('Use YYYY-MM-DD dates', { field });

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw AppError.badRequest('Use a valid calendar date', { field });
  }

  return { year, month, day };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function calendarDayNumber(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / 86_400_000;
}

function formatDateOnly(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function partsAt(instant: Date, timeZone: string): Required<CalendarDate> & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const actual = partsAt(instant, timeZone);
  const wallClock = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
  );
  const instantToSecond = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallClock - instantToSecond) / 60_000);
}

export interface TimeZoneOffsetSegment {
  /** First instant belonging to the next segment; null on the final segment. */
  until: Date | null;
  offsetMinutes: number;
}

/** Offset segments over a bounded reporting window. IANA transitions are
 * sparse (normally zero to four in the two-year maximum), so SQL can apply
 * numeric offsets without requiring MySQL's optional timezone tables. */
export function timeZoneOffsetSegments(
  start: Date,
  end: Date,
  timeZone: string,
): TimeZoneOffsetSegment[] {
  if (end <= start) return [];

  const segments: TimeZoneOffsetSegment[] = [];
  let offset = timeZoneOffsetMinutes(start, timeZone);
  let previousProbe = start;
  const stepMs = 6 * 60 * 60 * 1000;

  for (
    let probe = new Date(Math.min(start.getTime() + stepMs, end.getTime()));
    probe <= end;
    probe = new Date(Math.min(probe.getTime() + stepMs, end.getTime()))
  ) {
    const probeOffset = timeZoneOffsetMinutes(probe, timeZone);
    if (probeOffset !== offset) {
      let low = previousProbe.getTime();
      let high = probe.getTime();
      while (high - low > 1000) {
        const middle = Math.floor((low + high) / 2);
        if (timeZoneOffsetMinutes(new Date(middle), timeZone) === offset) low = middle;
        else high = middle;
      }

      // The binary search stops within one second. Round to that precision,
      // not the next whole minute: a high bound at 07:00:00.001 must remain
      // the 07:00 transition rather than incorrectly becoming 07:01.
      const transition = new Date(Math.floor(high / 1000) * 1000);
      segments.push({ until: transition, offsetMinutes: offset });
      offset = probeOffset;
    }

    if (probe.getTime() === end.getTime()) break;
    previousProbe = probe;
  }

  segments.push({ until: null, offsetMinutes: offset });
  return segments;
}

/** Convert local midnight in an IANA timezone to its UTC instant.
 *
 * `new Date('2026-09-20')` means midnight UTC, which is 04:00 in Dubai and
 * the previous evening in New York. Iterating the zone offset also handles
 * daylight-saving changes without relying on the server's own timezone.
 */
export function zonedStartOfDay(value: string, timeZone: string, field = 'from'): Date {
  const date = parseDateOnly(value, field);

  try {
    // Validate before doing arithmetic. Intl otherwise throws a RangeError
    // whose raw message would leak through as a 500.
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
  } catch {
    throw AppError.badRequest('The branch timezone is invalid', { field: 'timezone' });
  }

  const desiredWallClock = Date.UTC(date.year, date.month - 1, date.day);
  let instant = new Date(desiredWallClock);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsAt(instant, timeZone);
    const actualWallClock = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const next = new Date(instant.getTime() + desiredWallClock - actualWallClock);
    if (next.getTime() === instant.getTime()) return next;
    instant = next;
  }

  const actual = partsAt(instant, timeZone);
  if (
    actual.year !== date.year ||
    actual.month !== date.month ||
    actual.day !== date.day ||
    actual.hour !== 0 ||
    actual.minute !== 0
  ) {
    throw AppError.badRequest('This date has no local midnight in the branch timezone', {
      field,
      timezone: timeZone,
    });
  }

  return instant;
}

/** Calendar date at an instant in a named zone, independent of server locale. */
export function dateOnlyInTimeZone(instant: Date, timeZone: string): string {
  const parts = partsAt(instant, timeZone);
  return formatDateOnly(parts);
}

/** Shift a date-only value as calendar arithmetic. Month shifts clamp to the
 * destination month's final day (March 31 -> February 28/29), unlike
 * Date.setMonth which rolls it back into March. */
export function shiftDateOnly(
  value: string,
  { days = 0, months = 0 }: { days?: number; months?: number },
): string {
  const date = parseDateOnly(value, 'date');
  const monthIndex = date.year * 12 + (date.month - 1) + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const shiftedMonth = {
    year: targetYear,
    month: targetMonthIndex + 1,
    day: Math.min(date.day, lastDay),
  };
  return formatDateOnly(addDays(shiftedMonth, days));
}

export function resolveDateOnlyRange(
  from: string,
  to: string,
  timeZone: string,
  maxDays?: number,
): { start: Date; end: Date; days: number } {
  const fromDate = parseDateOnly(from, 'from');
  const toDate = parseDateOnly(to, 'to');
  const days = calendarDayNumber(toDate) - calendarDayNumber(fromDate) + 1;

  if (days <= 0) {
    throw AppError.badRequest('The end date must not be before the start date', { field: 'to' });
  }
  if (maxDays !== undefined && days > maxDays) {
    throw AppError.badRequest(`Choose a range of ${String(maxDays)} days or fewer`, {
      field: 'from',
      maxDays,
    });
  }

  return {
    start: zonedStartOfDay(from, timeZone, 'from'),
    end: zonedStartOfDay(formatDateOnly(addDays(toDate, 1)), timeZone, 'to'),
    days,
  };
}

export function optionalDateOnlyBounds(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;

  const start = from ? zonedStartOfDay(from, timeZone, 'from') : undefined;
  const toDate = to ? parseDateOnly(to, 'to') : undefined;
  const next = toDate ? addDays(toDate, 1) : undefined;
  const end = next
    ? zonedStartOfDay(formatDateOnly(next), timeZone, 'to')
    : undefined;

  if (start && end && end <= start) {
    throw AppError.badRequest('The end date must not be before the start date', { field: 'to' });
  }

  return { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
}
