/**
 * Jurisdiction-aware tax / VAT identifier rules (URG-023).
 *
 * ─── WHY THIS IS A SMALL TABLE AND NOT A WORLD ATLAS ─────────────────
 * The ticket is explicit on both halves: the UAE TRN must follow its legal
 * shape, AND other jurisdictions must not be forced into a UAE-only mask.
 * Those pull in opposite directions, and the failure mode of guessing is
 * asymmetric — refusing a legitimate identifier blocks an owner from saving
 * their own business, while accepting an unusual one costs nothing here,
 * because this value is printed on an invoice rather than used to compute
 * anything.
 *
 * So: countries with a rule we are CONFIDENT about are validated strictly.
 * Every other country is accepted as free text within the column's length.
 * An unknown country is never a reason to refuse.
 *
 * Adding a jurisdiction is a one-line entry, and the absence of one is a
 * deliberate "we do not know", never an oversight.
 */

export interface TaxIdRule {
  /** Canonical form check, applied after `normalize`. */
  test: (value: string) => boolean;
  /** Strips formatting the user may reasonably type (spaces, dashes). */
  normalize: (value: string) => string;
  /** Shown when `test` fails — states the SHAPE, never a real number. */
  hint: string;
  /** Placeholder-safe example. Structurally valid, not a real registration. */
  example: string;
}

const digitsOnly = (value: string) => value.replace(/[\s-]/g, '');

/**
 * Keyed by ISO 3166-1 alpha-2, matching `Business.country`.
 *
 * UAE: the TRN is a 15-digit number. This is the one the owner named, and the
 * one this install actually uses, so it is validated strictly.
 *
 * Saudi Arabia: the VAT number is likewise 15 digits. Included because a Gulf
 * multi-branch install is a realistic case for this app and the rule is
 * unambiguous.
 */
const RULES: Record<string, TaxIdRule> = {
  AE: {
    normalize: digitsOnly,
    test: (value) => /^\d{15}$/.test(value),
    hint: 'A UAE TRN is 15 digits.',
    example: '100123456700003',
  },
  SA: {
    normalize: digitsOnly,
    test: (value) => /^\d{15}$/.test(value),
    hint: 'A Saudi VAT number is 15 digits.',
    example: '300123456700003',
  },
};

export function taxIdRuleFor(country: string | null | undefined): TaxIdRule | null {
  if (!country) return null;
  return RULES[country.trim().toUpperCase()] ?? null;
}

export interface TaxIdCheck {
  ok: boolean;
  /** The value to store — normalized when a rule matched, else as given. */
  value: string;
  /** Populated only when `ok` is false. */
  hint?: string;
}

/**
 * Validate a tax id against its jurisdiction.
 *
 * An EMPTY value is always fine: every field on a business except its name is
 * optional by deliberate design, so that an owner can register a shop before
 * they have a tax registration.
 *
 * A country with no rule accepts anything — see the note above on why that is
 * the intended behaviour and not a gap.
 */
export function checkTaxId(
  raw: string | null | undefined,
  country: string | null | undefined,
): TaxIdCheck {
  const value = (raw ?? '').trim();
  if (!value) return { ok: true, value: '' };

  const rule = taxIdRuleFor(country);
  if (!rule) return { ok: true, value };

  const normalized = rule.normalize(value);
  if (!rule.test(normalized)) return { ok: false, value, hint: rule.hint };

  // Stored in its canonical form so two owners typing "100 1234 5678 00003"
  // and "100123456700003" produce the same record.
  return { ok: true, value: normalized };
}
