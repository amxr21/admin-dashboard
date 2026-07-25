// Runs in the Next.js Node runtime — Route Handlers, Server Components, SSR.
// Captures errors that happen on the server, before HTML reaches the browser.
//
// Loaded by instrumentation.ts.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENV ?? 'development',
  tracesSampleRate: 1.0,
  enabled:
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_ENV === 'preview',
});
