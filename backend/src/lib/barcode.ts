/**
 * Retail barcode symbologies (URG-028).
 *
 * ─── WHY A CURATED LIST AND NOT "ANY BARCODE" ────────────────────────
 * Same shape and the same reasoning as `tax-id.ts`: a small table of rules we
 * are CONFIDENT about, and anything outside it accepted rather than refused.
 * The asymmetry is what decides it — refusing a legitimate code stops an owner
 * saving a product that is physically on their shelf, while accepting an
 * unusual one costs nothing here, because this value is only ever matched
 * EXACTLY by the till's scan lookup. It is never parsed for meaning.
 *
 * The owner's decision was "curate the supported retail barcode types", so the
 * types below are the ones a shop actually meets: GS1 retail symbologies plus
 * CODE128, which is the general-purpose one used for internal labels.
 *
 * ─── WHY THE TYPE IS STORED AND NOT DERIVED ──────────────────────────
 * A stored `5012345678900` is a structurally valid EAN-13. The same digits are
 * also a legal prefix for other lengths, and CODE128 accepts almost anything —
 * so "which symbology is this" cannot be recovered from the digits alone once
 * saved. The owner's answer has to be recorded, not guessed at later.
 *
 * ─── LEGACY CODES ARE SURFACED, NEVER REWRITTEN ──────────────────────
 * `Product.barcode` is `@unique` and predates this module, so rows already
 * hold codes that may not match any type. `checkBarcode` is only ever called
 * for a write that TOUCHES the barcode or its type (mirroring how the
 * customers hook only acts when `phone` is present), so editing a product's
 * price can never fail on an old code. A code that does not fit its declared
 * type is reported for review; nothing here "corrects" a check digit, because
 * a recomputed digit would be a code that does not exist on the physical unit.
 */

export const BARCODE_TYPES = [
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'ITF14',
  'CODE128',
] as const;

export type BarcodeType = (typeof BARCODE_TYPES)[number];

export function isBarcodeType(value: string): value is BarcodeType {
  return (BARCODE_TYPES as readonly string[]).includes(value);
}

/**
 * GS1 mod-10 check digit, used by EAN-13/8, UPC-A and ITF-14.
 *
 * Weights alternate 3 and 1 from the RIGHTMOST data digit inward, which is why
 * this walks the string backwards rather than assuming a fixed length — the
 * same routine is then correct for all four lengths instead of four copies
 * that can drift apart.
 */
function hasValidGs1CheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  const expected = Number(digits.slice(-1));

  let sum = 0;
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[index]) * weight;
  }

  return (10 - (sum % 10)) % 10 === expected;
}

export interface BarcodeRule {
  /** Canonical form check, applied after `normalize`. */
  test: (value: string) => boolean;
  /** Strips formatting a person may reasonably type (spaces, dashes). */
  normalize: (value: string) => string;
  /** Shown when `test` fails — states the SHAPE, never a real code. */
  hint: string;
  /** Placeholder-safe example. Structurally valid, not a real product. */
  example: string;
}

const digitsOnly = (value: string) => value.replace(/[\s-]/g, '');
/** CODE128 is alphanumeric, so only whitespace is formatting noise here. */
const trimInner = (value: string) => value.replace(/\s/g, '');

const fixedLengthDigits = (length: number) => (value: string) =>
  new RegExp(`^\\d{${String(length)}}$`).test(value) && hasValidGs1CheckDigit(value);

const RULES: Record<BarcodeType, BarcodeRule> = {
  EAN13: {
    normalize: digitsOnly,
    test: fixedLengthDigits(13),
    hint: 'An EAN-13 is 13 digits, and the last digit must match its check digit.',
    example: '5012345678900',
  },
  EAN8: {
    normalize: digitsOnly,
    test: fixedLengthDigits(8),
    hint: 'An EAN-8 is 8 digits, and the last digit must match its check digit.',
    example: '96385074',
  },
  UPCA: {
    normalize: digitsOnly,
    test: fixedLengthDigits(12),
    hint: 'A UPC-A is 12 digits, and the last digit must match its check digit.',
    example: '036000291452',
  },
  /**
   * UPC-E is the zero-suppressed 8-digit form. Its check digit is computed
   * from the EXPANDED 12-digit code, not from the 8 digits as written, so a
   * mod-10 check applied directly here would reject valid codes. Expanding it
   * correctly is a table of six suppression rules — real work for a form this
   * app has never been asked to scan — so the length and numeric shape are
   * validated and the check digit deliberately is not. Stated here so nobody
   * later reads the absence as an oversight.
   */
  UPCE: {
    normalize: digitsOnly,
    test: (value) => /^\d{8}$/.test(value),
    hint: 'A UPC-E is 8 digits.',
    example: '04252614',
  },
  ITF14: {
    normalize: digitsOnly,
    test: fixedLengthDigits(14),
    hint: 'An ITF-14 is 14 digits, and the last digit must match its check digit.',
    example: '15012345678907',
  },
  /**
   * CODE128 encodes arbitrary ASCII and carries no check digit a reader
   * exposes, so there is no canonical shape to test. Bounded only by what the
   * column holds — validating anything more would be inventing a rule the
   * symbology does not have.
   */
  CODE128: {
    normalize: trimInner,
    test: (value) => value.length > 0 && value.length <= 48,
    hint: 'A CODE128 label can hold up to 48 characters.',
    example: 'SHELF-4471',
  },
};

export function barcodeRuleFor(type: string | null | undefined): BarcodeRule | null {
  if (!type) return null;
  const upper = type.trim().toUpperCase();
  return isBarcodeType(upper) ? RULES[upper] : null;
}

export interface BarcodeCheck {
  ok: boolean;
  /** The value to store — normalized when a rule matched, else as given. */
  value: string;
  /** Populated only when `ok` is false. */
  hint?: string;
}

/**
 * Validate a barcode against its declared symbology.
 *
 * An EMPTY value is always fine: a product may opt into having a barcode
 * before the label has been printed, which is exactly what `hasBarcode`
 * records. A type we do not recognise accepts anything, for the same reason
 * `checkTaxId` accepts an unknown country — an unfamiliar code is not
 * evidence the owner is wrong.
 *
 * No declared type also accepts anything: `barcode` predates this feature and
 * existing rows carry codes nobody classified.
 */
export function checkBarcode(
  raw: string | null | undefined,
  type: string | null | undefined,
): BarcodeCheck {
  const value = (raw ?? '').trim();
  if (!value) return { ok: true, value: '' };

  const rule = barcodeRuleFor(type);
  if (!rule) return { ok: true, value };

  const normalized = rule.normalize(value);
  if (!rule.test(normalized)) return { ok: false, value, hint: rule.hint };

  // Stored canonically so "5012 3456 78900" and "5012345678900" are the same
  // record — which matters more here than for a tax id, because the till
  // matches this column EXACTLY and a stored space makes a scan miss.
  return { ok: true, value: normalized };
}
