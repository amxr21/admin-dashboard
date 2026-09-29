/** Digits-only comparison key. Display values remain exactly as entered. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

/** Compare complete phone numbers, never arbitrary trailing fragments.
 * Explicit international numbers (plus/00), or unmarked long country-code
 * forms, must match in full. A complete 8–10-digit national number may omit
 * a trunk zero and a 1–3-digit country code on one side. Eight is the floor
 * because UAE landlines and GCC mobiles are eight digits without the zero. */
export function phonesMatch(a: string, b: string): boolean {
  const parts = (value: string) => {
    const digits = normalizePhone(value);
    const international = /^\s*(?:\+|00)/.test(value) || digits.length > 10;
    return {
      international,
      digits: international ? digits.replace(/^00/, '') : digits.replace(/^0/, ''),
    };
  };
  const left = parts(a);
  const right = parts(b);
  if (left.digits.length < 8 || right.digits.length < 8) return false;
  if (left.international === right.international) return left.digits === right.digits;
  const local = left.international ? right.digits : left.digits;
  const full = left.international ? left.digits : right.digits;
  const countryLength = full.length - local.length;
  return local.length <= 10 && countryLength >= 1 && countryLength <= 3 && full.endsWith(local);
}
