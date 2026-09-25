/**
 * Client-side mirror of the backend's placeholder rendering, used ONLY for
 * the on-screen preview. What is actually sent is rendered on the server
 * (`campaign-render.ts`), so a difference here could only mislead the
 * preview, never change a message.
 */

export const PLACEHOLDERS = ['customer_name', 'store_name', 'branch_name', 'discount_code'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface PreviewValues {
  customerName: string;
  storeName: string;
  branchName: string;
  discountCode: string;
}

export function fillPlaceholders(template: string, values: PreviewValues): string {
  const map: Record<Placeholder, string> = {
    customer_name: values.customerName.split(/\s+/)[0] ?? values.customerName,
    store_name: values.storeName,
    branch_name: values.branchName,
    discount_code: values.discountCode,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    (PLACEHOLDERS as readonly string[]).includes(key) ? map[key as Placeholder] : match,
  );
}

/**
 * A branch-local date and time as a UTC instant, without a date library:
 * guess, measure the zone's offset at the guess, correct, and measure again
 * so a daylight-saving boundary between the two lands on the right side.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - instant;
  };

  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

/** Every quarter hour of the day, as HH:mm — the schedule's time choices. */
export const QUARTER_HOURS: string[] = Array.from({ length: 96 }, (_, index) => {
  const hours = String(Math.floor(index / 4)).padStart(2, '0');
  const minutes = String((index % 4) * 15).padStart(2, '0');
  return `${hours}:${minutes}`;
});
