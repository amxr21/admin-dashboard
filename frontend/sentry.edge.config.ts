// Runs in the Vercel Edge runtime — middleware.ts and any route with
// `export const runtime = 'edge'`.
//
// Separate from sentry.server.config.ts because the Edge runtime has no Node
// APIs, so Sentry ships a different build for it. Without this file, errors
// thrown in middleware are simply never reported.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENV ?? 'development',
  tracesSampleRate: 1.0,
  enabled:
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_ENV === 'preview',
});
