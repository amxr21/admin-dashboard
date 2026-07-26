import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing. The single source of truth for which locales exist and how
 * they appear in URLs.
 */

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Locales that read right-to-left.
 *
 * A set rather than a hardcoded `locale === 'ar'` check: adding Hebrew, Farsi or
 * Urdu later should not mean hunting down every direction comparison in the
 * codebase.
 */
const RTL_LOCALES = new Set<string>(['ar', 'he', 'fa', 'ur']);

export type Direction = 'ltr' | 'rtl';

export function getDirection(locale: string): Direction {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,

  /**
   * 'as-needed' keeps the default locale unprefixed (`/orders`) and prefixes
   * others (`/ar/orders`).
   *
   * Chosen over 'always' so existing links, bookmarks and the production URL
   * keep working — this is a rebuild of a live app, not a greenfield project.
   */
  localePrefix: 'as-needed',

  /**
   * Deliberately OFF.
   *
   * With detection enabled, an Arabic-preferring browser hitting `/orders` is
   * redirected to `/ar/orders`, which means a shared link opens in a different
   * language than the sender saw. The locale switcher is explicit instead —
   * see the skill's guidance that routing on browser language surprises users.
   */
  localeDetection: false,
});
