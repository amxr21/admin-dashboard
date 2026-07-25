// Runs in the user's browser, once, before the app hydrates. Captures
// client-side errors, unhandled promise rejections, and performance traces
// from real users.
//
// This lives in instrumentation-client.ts rather than the older
// sentry.client.config.ts because the latter is deprecated and is ignored
// entirely under Turbopack.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENV ?? 'development',

  // Sample rates — dial these down as traffic grows.
  // 1.0 = capture 100%. At scale, drop traces to 0.1 or lower.
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,     // 10% of sessions get replay recording
  replaysOnErrorSampleRate: 1.0,     // 100% of sessions WITH errors get replay

  // Off in local dev so your own errors don't pollute the issue feed.
  // Preview deploys DO report — that's what previews are for.
  enabled:
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_ENV === 'preview',

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,             // never send visible text (PII protection)
      blockAllMedia: true,           // never send images/video
    }),
  ],

  // Strip PII from events before they leave the browser.
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies;
    if (event.request?.headers) {
      delete event.request.headers['Authorization'];
      delete event.request.headers['Cookie'];
    }
    return event;
  },
});

// Instruments client-side navigations so a slow route change shows up as a
// trace rather than as nothing at all.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
