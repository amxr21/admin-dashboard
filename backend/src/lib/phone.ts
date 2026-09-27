/** Digits-only comparison key. Display values remain exactly as entered. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

/** Fewer digits than this is not a phone number, just a guess at part of one. */
const MIN_PHONE_DIGITS = 7;

/**
 * Whether two phone numbers, typed however, are the same line: "050 123 4567",
 * "+971 50 123 4567" and "00971501234567" all match. Leading zeros (a trunk
 * or international prefix) are dropped and the country code may be missing
 * from one side, so one has to END with the other.
 *
 * A short fragment matches nothing — it is a guess, not a number.
 */
export function phonesMatch(a: string, b: string): boolean {
  const left = normalizePhone(a).replace(/^0+/, '');
  const right = normalizePhone(b).replace(/^0+/, '');
  if (Math.min(left.length, right.length) < MIN_PHONE_DIGITS) return false;
  return left.endsWith(right) || right.endsWith(left);
}
