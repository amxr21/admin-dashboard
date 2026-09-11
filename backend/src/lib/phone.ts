/** Digits-only comparison key. Display values remain exactly as entered. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}
