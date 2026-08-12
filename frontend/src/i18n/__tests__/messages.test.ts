import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';

import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';

/**
 * Guards the translation catalogues against the two failure modes that ship
 * silently:
 *
 *   1. A key added to one locale and not the other. The UI then renders the raw
 *      key ("counts.orders") to users of the missing locale.
 *   2. Arabic plural forms that omit categories. Arabic has SIX; falling back
 *      to `other` reads wrong to native speakers for 2, 3-10, and 11-99.
 */

type Messages = Record<string, unknown>;

/** Flatten to dotted paths so the two catalogues can be compared key-for-key. */
function flatten(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object'
      ? flatten(value as Messages, path)
      : [path];
  });
}

function valueAt(obj: Messages, path: string): string {
  return path.split('.').reduce<unknown>((acc, part) => {
    return (acc as Messages)[part];
  }, obj) as string;
}

const enKeys = flatten(en as Messages).sort();
const arKeys = flatten(ar as Messages).sort();

describe('catalogue parity', () => {
  it('has no keys missing from Arabic', () => {
    const missing = enKeys.filter((key) => !arKeys.includes(key));
    expect(missing, `missing from ar.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no keys missing from English', () => {
    const missing = arKeys.filter((key) => !enKeys.includes(key));
    expect(missing, `missing from en.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no empty strings in either locale', () => {
    // An empty value renders as nothing, which looks like a layout bug rather
    // than a missing translation.
    for (const key of enKeys) {
      expect(valueAt(en as Messages, key).trim(), `en.${key}`).not.toBe('');
      expect(valueAt(ar as Messages, key).trim(), `ar.${key}`).not.toBe('');
    }
  });
});

describe('Arabic is actually translated', () => {
  it('does not leave UI strings identical to English', () => {
    // Catches a catalogue copied but never translated. Brand names, technical
    // terms and the language labels themselves are legitimately identical —
    // per the skill, "iPhone"/"WhatsApp"/"Excel" stay in Latin script.
    const legitimatelyIdentical = new Set([
      'common.appName',
      'language.en',
      'language.ar',
      'auth.emailPlaceholder',
      // A brand name, same reasoning as "iPhone"/"WhatsApp"/"Excel".
      'diagnostics.sentry',
      // Format examples, not prose — a courier access code's grouping
      // pattern and a URL scheme are the same shape in every language,
      // same reasoning as `auth.emailPlaceholder` above.
      'courier.login.codePlaceholder',
      'imageUpload.urlPlaceholder',
      // A timezone abbreviation, not prose — used as-is in Arabic technical
      // UI, same reasoning as "iPhone"/"WhatsApp"/"Excel" above.
      'table.utc',
      // A type-to-confirm phrase: the literal string a user retypes to arm a
      // destructive action. Translating it would let the phrase SHOWN and the
      // phrase COMPARED drift apart, silently breaking the safeguard in one
      // locale.
      'delivery.detail.dangerZone.deactivate.confirmPhrase',
    ]);

    const untranslated = enKeys.filter(
      (key) =>
        !legitimatelyIdentical.has(key) &&
        valueAt(en as Messages, key) === valueAt(ar as Messages, key),
    );

    expect(untranslated, `identical in both locales: ${untranslated.join(', ')}`).toEqual(
      [],
    );
  });

  it('uses Arabic script for translated values', () => {
    const arabicRange = /[؀-ۿ]/;

    expect(valueAt(ar as Messages, 'common.save')).toMatch(arabicRange);
    expect(valueAt(ar as Messages, 'orderStatus.PENDING')).toMatch(arabicRange);
    expect(valueAt(ar as Messages, 'nav.orders')).toMatch(arabicRange);
  });
});

describe('DB enum coverage', () => {
  // The skill's rule: the DB stores English keys, the UI translates them. Every
  // enum needs a namespace or a status badge renders a raw SCREAMING_CASE value.
  const enumNamespaces = [
    ['roles', ['DEVELOPER', 'OWNER', 'MANAGER', 'FULFILLMENT', 'SUPPORT', 'DEMO']],
    [
      'orderStatus',
      ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELED', 'RETURNED'],
    ],
    ['productStatus', ['DRAFT', 'ACTIVE', 'ARCHIVED']],
    ['reviewStatus', ['PENDING', 'APPROVED', 'REJECTED']],
    ['discountType', ['PERCENT', 'FIXED']],
    ['deliveryStaffStatus', ['ACTIVE', 'ON_SHIFT', 'INACTIVE']],
    [
      'deliveryStatus',
      ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'HANDED_OVER'],
    ],
    ['returnStatus', ['REQUESTED', 'APPROVED', 'REJECTED']],
    ['returnResolution', ['NONE', 'REFUND', 'STORE_CREDIT', 'REPLACEMENT']],
  ] as const;

  it.each(enumNamespaces)('translates every %s value in both locales', (ns, values) => {
    for (const value of values) {
      expect(valueAt(en as Messages, `${ns}.${value}`), `en.${ns}.${value}`).toBeTruthy();
      expect(valueAt(ar as Messages, `${ns}.${value}`), `ar.${ns}.${value}`).toBeTruthy();
    }
  });
});

describe('ICU pluralisation', () => {
  const countKeys = flatten((en as Messages).counts as Messages).map(
    (key) => `counts.${key}`,
  );

  it('provides all six Arabic plural categories', () => {
    // Arabic distinguishes zero/one/two/few/many/other. English has two.
    // Omitting them falls back to `other`, which reads wrong to a native
    // speaker for 2, for 3-10, and for 11-99 — i.e. most real numbers.
    const required = ['one', 'two', 'few', 'many', 'other'];

    for (const key of countKeys) {
      const message = valueAt(ar as Messages, key);
      for (const category of required) {
        expect(message, `ar.${key} missing '${category}'`).toContain(`${category} {`);
      }
    }
  });

  it('resolves Arabic categories to genuinely different strings', () => {
    // Parity of FORM is not enough — the categories must produce different
    // text, or they were filled in mechanically.
    const message = new IntlMessageFormat(
      valueAt(ar as Messages, 'counts.products'),
      'ar',
    );

    const results = [1, 2, 3, 11].map((count) => String(message.format({ count })));

    expect(new Set(results).size).toBe(results.length);
  });

  it('resolves English plurals correctly', () => {
    const message = new IntlMessageFormat(
      valueAt(en as Messages, 'counts.products'),
      'en',
    );

    expect(String(message.format({ count: 0 }))).toBe('No products');
    expect(String(message.format({ count: 1 }))).toBe('1 product');
    expect(String(message.format({ count: 5 }))).toBe('5 products');
  });

  it('parses every ICU message in both locales without error', () => {
    // A malformed ICU string throws at RENDER time, so it reaches production
    // unless something parses it in CI.
    for (const key of countKeys) {
      expect(
        () => new IntlMessageFormat(valueAt(en as Messages, key), 'en'),
        `en.${key}`,
      ).not.toThrow();
      expect(
        () => new IntlMessageFormat(valueAt(ar as Messages, key), 'ar'),
        `ar.${key}`,
      ).not.toThrow();
    }
  });
});
