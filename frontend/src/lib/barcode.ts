/**
 * Retail barcode symbologies (URG-028) — client mirror.
 *
 * Mirrors `backend/src/lib/barcode.ts`. The server is the authority; this
 * exists so the shape is visible BEFORE submitting, and so the placeholder
 * shows an example of the type actually selected rather than a generic one.
 *
 * Kept as a parallel table rather than fetched, for the same reason
 * `tax-id.ts` is: these are a handful of rules, and a round trip to learn
 * "an EAN-13 is 13 digits" would make the form worse.
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

export interface BarcodeRule {
  test: (value: string) => boolean;
  normalize: (value: string) => string;
  /** Translation KEY, not prose — localized at the call site. */
  hintKey: string;
  example: string;
}

const digitsOnly = (value: string) => value.replace(/[\s-]/g, '');
const trimInner = (value: string) => value.replace(/\s/g, '');

/** GS1 mod-10, weights alternating 3/1 from the rightmost data digit. */
function hasValidGs1CheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  const expected = Number(digits.slice(-1));

  let sum = 0;
  for (
    let index = body.length - 1, weight = 3;
    index >= 0;
    index -= 1, weight = weight === 3 ? 1 : 3
  ) {
    sum += Number(body[index]) * weight;
  }

  return (10 - (sum % 10)) % 10 === expected;
}

const fixedLengthDigits = (length: number) => (value: string) =>
  new RegExp(`^\\d{${String(length)}}$`).test(value) && hasValidGs1CheckDigit(value);

const RULES: Record<BarcodeType, BarcodeRule> = {
  EAN13: {
    normalize: digitsOnly,
    test: fixedLengthDigits(13),
    hintKey: 'barcodeHintEAN13',
    example: '5012345678900',
  },
  EAN8: {
    normalize: digitsOnly,
    test: fixedLengthDigits(8),
    hintKey: 'barcodeHintEAN8',
    example: '96385074',
  },
  UPCA: {
    normalize: digitsOnly,
    test: fixedLengthDigits(12),
    hintKey: 'barcodeHintUPCA',
    example: '036000291452',
  },
  /** Check digit deliberately unvalidated — see the backend note on why the
   *  zero-suppressed form needs expansion first. */
  UPCE: {
    normalize: digitsOnly,
    test: (value) => /^\d{8}$/.test(value),
    hintKey: 'barcodeHintUPCE',
    example: '04252614',
  },
  ITF14: {
    normalize: digitsOnly,
    test: fixedLengthDigits(14),
    hintKey: 'barcodeHintITF14',
    example: '15012345678907',
  },
  CODE128: {
    normalize: trimInner,
    test: (value) => value.length > 0 && value.length <= 48,
    hintKey: 'barcodeHintCODE128',
    example: 'SHELF-4471',
  },
};

export function barcodeRuleFor(type: string | null | undefined): BarcodeRule | null {
  if (!type) return null;
  const upper = type.trim().toUpperCase();
  return (BARCODE_TYPES as readonly string[]).includes(upper)
    ? RULES[upper as BarcodeType]
    : null;
}

/**
 * Empty is valid (a product may opt in before its label is printed), and an
 * unrecognised or absent type accepts anything — legacy rows carry codes
 * nobody classified, and an unfamiliar code is not evidence of a mistake.
 */
export function isValidBarcode(raw: string, type: string | null | undefined): boolean {
  const value = raw.trim();
  if (!value) return true;
  const rule = barcodeRuleFor(type);
  if (!rule) return true;
  return rule.test(rule.normalize(value));
}

/** The selected type's own example, or null to fall back to the shared one. */
export function barcodeExampleFor(type: string | null | undefined): string | null {
  return barcodeRuleFor(type)?.example ?? null;
}
