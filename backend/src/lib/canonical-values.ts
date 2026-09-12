/**
 * Server-side membership checks for the canonical organization fields
 * (URG-016/017/018).
 *
 * The existing Zod rules check SHAPE only — `.length(2)` accepts "ZZ" and
 * `.length(3)` accepts "XYZ". A select on the client is a convenience, never
 * a control: the API is reachable directly, so the catalogue has to be
 * enforced here or it is not enforced at all.
 *
 * Uses the runtime's own `Intl` data for the same reason the frontend does —
 * no dataset to bundle, no list to keep current, and Node and the browser
 * agree because both read CLDR/ICU.
 */

let currencyCache: Set<string> | null = null;
let timezoneCache: Set<string> | null = null;

function currencies(): Set<string> {
  currencyCache ??= new Set(Intl.supportedValuesOf('currency'));
  return currencyCache;
}

function timezones(): Set<string> {
  timezoneCache ??= new Set(Intl.supportedValuesOf('timeZone'));
  return timezoneCache;
}

/** ISO 4217, uppercase. */
export function isCanonicalCurrency(value: string): boolean {
  return currencies().has(value.trim().toUpperCase());
}

/**
 * IANA zone id, case-sensitive.
 *
 * Deliberately NOT case-insensitive: "asia/dubai" is not a valid zone id, and
 * accepting it here would store a value that `Intl.DateTimeFormat` later
 * throws on — a shift that crosses midnight is exactly where that surfaces.
 */
export function isCanonicalTimezone(value: string): boolean {
  return timezones().has(value.trim());
}

/**
 * ISO 3166-1 alpha-2, uppercase.
 *
 * `DisplayNames.of` echoes its input back for an unassigned code, so a label
 * that differs from the code is the signal that the region is real.
 */
export function isCanonicalCountry(value: string): boolean {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  try {
    const label = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return Boolean(label) && label !== code;
  } catch {
    return false;
  }
}

/**
 * The curated business-type catalogue (URG-021).
 *
 * Mirrors `frontend/src/lib/business-types.ts`. Kept as a plain list rather
 * than a Prisma enum because the owner expects it to grow, and a column that
 * already holds free text costs nothing to widen later.
 */
export const BUSINESS_TYPES = [
  'RESTAURANT',
  'CAFE',
  'BAKERY',
  'FOOD_TRUCK',
  'GROCERY',
  'SUPERMARKET',
  'PHARMACY',
  'CLOTHING',
  'ELECTRONICS',
  'FURNITURE',
  'JEWELLERY',
  'BOOKSTORE',
  'SALON',
  'BARBERSHOP',
  'SPA',
  'GYM',
  'LAUNDRY',
  'OTHER',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export function isBusinessType(value: string): value is BusinessType {
  return (BUSINESS_TYPES as readonly string[]).includes(value.trim());
}
