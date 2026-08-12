'use client';

import { useCallback } from 'react';
import { useFormatter } from 'next-intl';

import { useAppSettings } from '@/components/providers/settings-provider';

/**
 * Formats a money value in the STORE's currency, live — not the
 * `i18n/formats.ts` `'currency'` FORMAT's hardcoded AED.
 *
 * ─── WHY THIS IS A HOOK, NOT A CHANGE TO i18n/formats.ts ─────────────────
 * `FORMATS` is baked into every request server-side via `getRequestConfig`
 * (`i18n/request.ts`), which runs before any auth or settings context
 * exists — there is no live DB value to read at that layer. `store.currency`
 * only becomes available once `SettingsProvider` has fetched the registry,
 * client-side. So the FORMAT SHAPE (grouping, decimal places, numbering
 * system) still comes from the shared `'currency'` format; only the
 * currency CODE is overridden per-call from the live setting — the one
 * piece that can't be static.
 *
 * `next-intl`'s `formatter.number(value, options)` accepts an inline options
 * object in place of a named-format string, so overriding just `currency`
 * still gets every other property (`style: 'currency'`, `numberingSystem:
 * 'latn'`) from the same shared definition — never a second, hand-typed copy
 * of the format that could drift from `formats.ts`.
 */
export function useCurrencyFormat(): (value: number) => string {
  const formatter = useFormatter();
  const { storeCurrency } = useAppSettings();

  return useCallback(
    (value: number) =>
      formatter.number(value, {
        style: 'currency',
        currency: storeCurrency,
        numberingSystem: 'latn',
      }),
    [formatter, storeCurrency],
  );
}
