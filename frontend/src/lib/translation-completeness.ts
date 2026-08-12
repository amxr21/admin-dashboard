import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

/**
 * Computes en/ar catalogue parity at RENDER time, straight from the same two
 * JSON files `messages.test.ts` already guards in CI — this is the same
 * check, surfaced as something a non-technical admin can see without running
 * the test suite. Deliberately only ever imported from a Server Component
 * (see `translation-completeness-panel.tsx`): both catalogues together are
 * ~50KB of JSON that a client bundle has no reason to ship twice (next-intl
 * already sends the ACTIVE locale to the browser; this needs both at once).
 */

type Messages = Record<string, unknown>;

function flatten(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object'
      ? flatten(value as Messages, path)
      : [path];
  });
}

export interface TranslationCompleteness {
  totalKeys: number;
  missingFromAr: string[];
  missingFromEn: string[];
  /** In sync only when both locales declare the exact same key set. */
  inSync: boolean;
}

export function computeTranslationCompleteness(): TranslationCompleteness {
  const enKeys = new Set(flatten(en as Messages));
  const arKeys = new Set(flatten(ar as Messages));

  const missingFromAr = [...enKeys].filter((key) => !arKeys.has(key)).sort();
  const missingFromEn = [...arKeys].filter((key) => !enKeys.has(key)).sort();

  return {
    totalKeys: enKeys.size,
    missingFromAr,
    missingFromEn,
    inSync: missingFromAr.length === 0 && missingFromEn.length === 0,
  };
}
