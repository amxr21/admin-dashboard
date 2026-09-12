/**
 * Jurisdiction-aware tax / VAT identifier rules (URG-023) — client mirror.
 *
 * Mirrors `backend/src/lib/tax-id.ts`. The server is the authority; this
 * exists so the owner sees the expected shape BEFORE submitting, and gets a
 * country-appropriate example in the placeholder rather than a UAE one on a
 * business registered elsewhere.
 *
 * Kept as a parallel table rather than shared through an API call: it is four
 * lines of rules, and a round trip to learn "a UAE TRN is 15 digits" would
 * make the form worse.
 */

export interface TaxIdRule {
  test: (value: string) => boolean;
  normalize: (value: string) => string;
  /** Translation KEY, not prose — the message is localized at the call site. */
  hintKey: string;
  example: string;
}

const digitsOnly = (value: string) => value.replace(/[\s-]/g, '');

const RULES: Record<string, TaxIdRule> = {
  AE: {
    normalize: digitsOnly,
    test: (value) => /^\d{15}$/.test(value),
    hintKey: 'taxIdHintAE',
    example: '100123456700003',
  },
  SA: {
    normalize: digitsOnly,
    test: (value) => /^\d{15}$/.test(value),
    hintKey: 'taxIdHintSA',
    example: '300123456700003',
  },
};

export function taxIdRuleFor(country: string | null | undefined): TaxIdRule | null {
  if (!country) return null;
  return RULES[country.trim().toUpperCase()] ?? null;
}

/**
 * Empty is valid (every business field but the name is optional), and a
 * country with no rule accepts anything — see the backend note for why that
 * is intended rather than a gap.
 */
export function isValidTaxId(raw: string, country: string | null | undefined): boolean {
  const value = raw.trim();
  if (!value) return true;
  const rule = taxIdRuleFor(country);
  if (!rule) return true;
  return rule.test(rule.normalize(value));
}

/** The country's own example, or null to fall back to the shared placeholder. */
export function taxIdExampleFor(country: string | null | undefined): string | null {
  return taxIdRuleFor(country)?.example ?? null;
}
