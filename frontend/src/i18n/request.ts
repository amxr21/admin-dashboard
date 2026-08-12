import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';

import { FORMATS } from './formats';
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

    // One shared definition, imported by the test provider too.
    formats: FORMATS,
  };
});
