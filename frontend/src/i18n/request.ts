import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';

import { routing } from './routing';

/**
 * Per-request i18n config. next-intl calls this on the server for every
 * request to resolve the locale and load its messages.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  // Fall back rather than throw: a malformed or unknown locale in the URL
  // should render the default language, not a 500.
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default as Record<
      string,
      unknown
    >,

    /**
     * UTC for consistency. An admin dashboard is read by staff in different
     * places, and a timestamp that means something different depending on who
     * opens it is worse than one that is explicitly UTC. Revisit if per-user
     * timezones become a requirement.
     */
    timeZone: 'UTC',

    formats: {
      dateTime: {
        short: { day: '2-digit', month: '2-digit', year: 'numeric' },
        long: { day: 'numeric', month: 'long', year: 'numeric' },
      },
      number: {
        /**
         * Western Arabic numerals (0-9) in BOTH locales.
         *
         * This is the modern Gulf/UAE web convention — u.ae and ICP both use
         * them — and it keeps order numbers, SKUs and IDs copy-pasteable
         * between languages. Eastern Arabic-Indic numerals (٠-٩) would be
         * correct for a conservative Saudi institutional context; they are a
         * deliberate choice, not a default.
         *
         * The rule that matters: never MIX the two.
         */
        currency: {
          style: 'currency',
          currency: 'AED',
          numberingSystem: 'latn',
        },
        decimal: { numberingSystem: 'latn' },
      },
    },
  };
});
