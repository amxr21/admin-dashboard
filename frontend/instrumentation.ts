import * as Sentry from '@sentry/nextjs';

/**
 * Next.js server instrumentation hook.
 *
 * Next runs `register()` once per server runtime, before any application code.
 * The Node and Edge runtimes need different Sentry builds, so we branch on
 * NEXT_RUNTIME and load only the matching config. Importing both would break
 * the Edge bundle (it has no Node APIs).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config.js');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config.js');
  }
}

/**
 * Captures errors thrown inside Server Components, Route Handlers, and Server
 * Actions. Without this export those errors are swallowed by React's error
 * boundary and never reach Sentry.
 */
export const onRequestError = Sentry.captureRequestError;
