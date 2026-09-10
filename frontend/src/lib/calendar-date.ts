/**
 * A local calendar date (`YYYY-MM-DD`) without a timezone conversion.
 *
 * `toISOString()` converts to UTC first and can move the selected day. Filters,
 * date pickers and future scheduling surfaces should all use this helper when
 * they mean the user's local calendar day rather than an instant in time.
 */
export function toLocalCalendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
