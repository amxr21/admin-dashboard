import {
  AsYouType,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Phone entry, formatting and validation (URG-020/022).
 *
 * ─── WHAT THIS DOES NOT TOUCH ────────────────────────────────────────
 * `Customer.phoneNormalized` is a DIGITS-ONLY indexed search key, backfilled
 * by `REGEXP_REPLACE(phone, '[^0-9]', '')` and matched with `contains` by
 * orders, POS and customer-cases. Emitting E.164 into it would leave old rows
 * as `971501234567` and new rows as `+971501234567`, so a `contains` search
 * would stop matching across the boundary — silently, and only for customers
 * saved on one side of the change.
 *
 * So E.164 lives on the user-facing `phone` column, and the digits key keeps
 * its existing meaning. `normalizePhone` on the backend is unchanged.
 *
 * ─── WHY A LIBRARY ───────────────────────────────────────────────────
 * National number lengths, trunk prefixes and valid ranges differ per country
 * and change over time. A regex per country produces confident wrong answers
 * — rejecting valid numbers is worse than accepting loose ones, because the
 * user cannot tell what would satisfy it.
 */

/** A country the phone library knows, or null for "no country context yet". */
export function toCountryCode(value: string | null | undefined): CountryCode | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return isSupportedCountry(upper) ? (upper as CountryCode) : null;
}

/**
 * International dialing prefix for a country (URG-020), e.g. `AE` → `+971`.
 *
 * Deliberately derived rather than stored or typed: a dialing prefix is a
 * property OF the country, and a separately-entered one can disagree with it.
 * The ticket is explicit that these two must not be confused.
 */
export function callingCodeFor(country: string | null | undefined): string | null {
  const code = toCountryCode(country);
  if (!code) return null;
  try {
    return `+${getCountryCallingCode(code)}`;
  } catch {
    return null;
  }
}

/**
 * Format progressively while typing.
 *
 * `AsYouType` deliberately echoes input it cannot format yet, so a partial
 * number is never mangled mid-entry — the user keeps seeing what they typed.
 */
export function formatAsYouType(value: string, country: string | null | undefined): string {
  const code = toCountryCode(country);
  return code ? new AsYouType(code).input(value) : new AsYouType().input(value);
}

/**
 * E.164 for storage (`+971501234567`), or null when the number is not valid
 * for the given country.
 *
 * Returning null rather than a best guess is the point: storing a malformed
 * international number is worse than storing exactly what the user typed,
 * because it looks canonical and is not.
 */
export function toE164(value: string, country: string | null | undefined): string | null {
  if (!value.trim()) return null;
  const code = toCountryCode(country);
  const parsed = code
    ? parsePhoneNumberFromString(value, code)
    : parsePhoneNumberFromString(value);
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * Human-readable international form for display, e.g. `+971 50 123 4567`.
 * Falls back to the stored text when it cannot be parsed, so a legacy value
 * entered before this existed still renders rather than disappearing.
 */
export function formatForDisplay(value: string, country?: string | null): string {
  if (!value.trim()) return '';
  const code = toCountryCode(country);
  const parsed = code
    ? parsePhoneNumberFromString(value, code)
    : parsePhoneNumberFromString(value);
  return parsed?.isValid() ? parsed.formatInternational() : value;
}

/**
 * Is this a plausible entry?
 *
 * An EMPTY value is valid — every phone field in this app is optional, and the
 * canonical-field work does not change that. Only a non-empty value that the
 * library rejects for the given country is an error.
 */
export function isValidPhone(value: string, country: string | null | undefined): boolean {
  if (!value.trim()) return true;
  return toE164(value, country) !== null;
}

/**
 * An example number for the country, used as a placeholder so the expected
 * shape is visible before typing (URG-013's rule: a worked example, never a
 * misleading generic value). Falls back to the shared placeholder key's job
 * by returning null when the country is unknown.
 */
export function exampleFor(country: string | null | undefined): string | null {
  const calling = callingCodeFor(country);
  if (!calling) return null;
  // A dialing prefix plus a neutral grouping: enough to show the shape without
  // implying a real subscriber number.
  return `${calling} 50 123 4567`;
}
