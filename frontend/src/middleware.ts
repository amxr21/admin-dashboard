import createMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';

export default createMiddleware(routing);

export const config = {
  /**
   * Run on everything EXCEPT the paths below.
   *
   * `/monitoring` is excluded deliberately — it's the Sentry tunnel route
   * configured in next.config.ts. Routing it through the locale middleware
   * would rewrite it to `/en/monitoring` and silently break error reporting.
   *
   * Also excluded: Next internals, static files (anything with an extension),
   * and API routes, none of which have a locale.
   */
  matcher: ['/((?!api|monitoring|_next|_vercel|.*\\..*).*)'],
};
