export const EMAIL_MAX_LENGTH = 255;

export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** A fast form hint; the API's shared Zod contract remains authoritative. */
export function isAccountEmailValid(value: string): boolean {
  const normalized = normalizeAccountEmail(value);
  if (normalized.length === 0 || normalized.length > EMAIL_MAX_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}
