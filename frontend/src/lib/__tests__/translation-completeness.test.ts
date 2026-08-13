import { describe, expect, it } from 'vitest';

import { computeTranslationCompleteness } from '../translation-completeness';

/**
 * B3.7 — translation completeness dashboard. This exercises the REAL
 * `messages/en.json`/`ar.json` (same files `messages.test.ts` guards in CI)
 * rather than a fixture — the whole point of this function is to report the
 * actual current state of the actual catalogues, so a fixture would only
 * prove the flattening logic works, not that the dashboard tells the truth.
 */

describe('computeTranslationCompleteness', () => {
  it('reports the real catalogues as in sync (messages.test.ts enforces this in CI)', () => {
    const result = computeTranslationCompleteness();

    expect(result.inSync).toBe(true);
    expect(result.missingFromAr).toEqual([]);
    expect(result.missingFromEn).toEqual([]);
  });

  it('reports a total key count that matches the real catalogue size', () => {
    const result = computeTranslationCompleteness();

    // Not a fixed number pinned in the test (that would just duplicate the
    // catalogue's current size and rot on the next key addition) — only that
    // it's a real, sane count.
    expect(result.totalKeys).toBeGreaterThan(500);
  });
});
