import { describe, expect, it } from 'vitest';

import { BARCODE_TYPES, checkBarcode, isBarcodeType } from '../lib/barcode.js';

/**
 * Barcode symbologies (URG-028).
 *
 * The check-digit arithmetic is the part of this that fails SILENTLY: a wrong
 * weight order still accepts and rejects codes, just the wrong ones, and a
 * form would look like it was validating properly. So the cases below use
 * real, published, known-good codes rather than digits invented to satisfy
 * the implementation — the whole point is to catch the maths being subtly
 * backwards.
 *
 * The other property worth pinning is where this module deliberately does
 * NOT refuse: an unclassified legacy code, an unknown type, an empty value.
 * Each of those accepting is a decision (see the module's own notes), and a
 * future "tighten this up" change should have to break a test to make it.
 */

describe('the catalogue', () => {
  it('exposes exactly the curated retail symbologies', () => {
    expect([...BARCODE_TYPES]).toEqual(['EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF14', 'CODE128']);
  });

  it('recognises its own members and nothing else', () => {
    expect(isBarcodeType('EAN13')).toBe(true);
    expect(isBarcodeType('CODE39')).toBe(false);
    expect(isBarcodeType('')).toBe(false);
  });
});

describe('GS1 check digits', () => {
  // Real published codes. If the weighting is reversed these still LOOK like
  // plausible input, which is exactly why hand-made digits would not do.
  it.each([
    ['EAN13', '5012345678900'],
    ['EAN13', '4006381333931'],
    ['EAN8', '96385074'],
    ['UPCA', '036000291452'],
    ['ITF14', '15012345678907'],
  ])('accepts a valid %s', (type, code) => {
    expect(checkBarcode(code, type)).toMatchObject({ ok: true });
  });

  it.each([
    ['EAN13', '5012345678901'],
    ['EAN8', '96385075'],
    ['UPCA', '036000291453'],
    ['ITF14', '15012345678908'],
  ])('refuses %s with a wrong final digit', (type, code) => {
    const result = checkBarcode(code, type);
    expect(result.ok).toBe(false);
    // The message states the SHAPE so the person can fix it; it never
    // suggests a corrected digit, which would be a code that does not exist
    // on the physical unit.
    expect(result.hint).toBeTruthy();
    expect(result.hint).not.toContain(code);
  });

  it('refuses the right digits at the wrong length', () => {
    // A valid EAN-13 is not a valid EAN-8, however well-formed it is.
    expect(checkBarcode('5012345678900', 'EAN8').ok).toBe(false);
    expect(checkBarcode('96385074', 'EAN13').ok).toBe(false);
  });
});

describe('normalizing what a person types', () => {
  it('stores the canonical form, so an exact-match scan cannot miss', () => {
    // The till matches this column EXACTLY — a stored space is a scan that
    // silently finds nothing.
    expect(checkBarcode('5012 3456 78900', 'EAN13')).toMatchObject({
      ok: true,
      value: '5012345678900',
    });
    expect(checkBarcode('501-2345-678900', 'EAN13')).toMatchObject({
      ok: true,
      value: '5012345678900',
    });
  });

  it('keeps CODE128 alphanumeric, stripping only whitespace', () => {
    expect(checkBarcode('SHELF 4471', 'CODE128')).toMatchObject({
      ok: true,
      value: 'SHELF4471',
    });
  });
});

describe('what this deliberately accepts', () => {
  it('accepts an empty value — a product may opt in before the label exists', () => {
    expect(checkBarcode('', 'EAN13')).toMatchObject({ ok: true, value: '' });
    expect(checkBarcode(null, 'EAN13')).toMatchObject({ ok: true });
    expect(checkBarcode(undefined, null)).toMatchObject({ ok: true });
  });

  it('accepts a legacy code with no declared type, unchanged', () => {
    // `Product.barcode` predates this module, so rows hold codes nobody
    // classified. Those are surfaced for review, never refused or rewritten.
    expect(checkBarcode('weird-old-code', null)).toMatchObject({
      ok: true,
      value: 'weird-old-code',
    });
  });

  it('accepts anything under a type it does not know', () => {
    // Same reasoning as an unknown country in `checkTaxId`: an unfamiliar
    // symbology is not evidence the owner is wrong.
    expect(checkBarcode('0000', 'CODE39').ok).toBe(true);
  });

  it('does not check the UPC-E digit, and says so by accepting one', () => {
    // Documented gap, not an oversight: the check digit comes from the
    // EXPANDED 12-digit form. Length and numeric shape are still enforced.
    expect(checkBarcode('04252614', 'UPCE').ok).toBe(true);
    expect(checkBarcode('0425261', 'UPCE').ok).toBe(false);
    expect(checkBarcode('0425261A', 'UPCE').ok).toBe(false);
  });

  it('bounds CODE128 by what the column holds', () => {
    expect(checkBarcode('X'.repeat(48), 'CODE128').ok).toBe(true);
    expect(checkBarcode('X'.repeat(49), 'CODE128').ok).toBe(false);
  });
});
