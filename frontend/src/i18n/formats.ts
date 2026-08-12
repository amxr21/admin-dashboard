/**
 * The app's number and date formats, in ONE place.
 *
 * These were previously duplicated between `i18n/request.ts` (the real
 * provider) and `test/render.tsx` (the test provider), with a comment on the
 * copy asking whoever edited one to remember the other. That held until it
 * didn't: adding a `percent` format to the real provider left every test
 * rendering percentages through next-intl's fallback, so a component was
 * correct in the browser and quietly different under test — the exact class of
 * drift a test suite is supposed to catch rather than cause.
 *
 * Importing the same object into both means a new format is available
 * everywhere the moment it is declared.
 */
export const FORMATS = {
  dateTime: {
    short: { day: '2-digit', month: '2-digit', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
  },
  number: {
    /**
     * Western Arabic numerals (0-9) in BOTH locales.
     *
     * This is the modern Gulf/UAE web convention — u.ae and ICP both use them —
     * and it keeps order numbers, SKUs and IDs copy-pasteable between
     * languages. Eastern Arabic-Indic numerals (٠-٩) would be correct for a
     * conservative Saudi institutional context; they are a deliberate choice,
     * not a default.
     *
     * The rule that matters: never MIX the two.
     */
    currency: {
      style: 'currency',
      currency: 'AED',
      numberingSystem: 'latn',
    },
    decimal: { numberingSystem: 'latn' },
    /**
     * Takes a RATIO (0.42), not a pre-multiplied 42 — `Intl` does the ×100
     * itself, and passing an already-scaled number is the classic way to
     * render "4200%".
     *
     * One decimal place: a margin quoted to four decimals implies a precision
     * the inputs don't have.
     */
    percent: {
      style: 'percent',
      maximumFractionDigits: 1,
      numberingSystem: 'latn',
    },
  },
} as const;
