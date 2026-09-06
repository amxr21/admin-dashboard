// Sentry init for the Express backend.
//
// IMPORTANT: this must be imported at the very TOP of the entry file
// (src/server.ts), BEFORE any other import that might throw. Sentry needs to
// hook into Node's error handling before application code runs, or early
// errors are missed entirely.
//
//   import './sentry.js';     // ← MUST BE FIRST
//   import { createApp } from './app.js';
//   ...

import * as Sentry from '@sentry/node';
import { env, isProduction } from './config/env.js';

// Off outside production so local errors don't pollute the issue feed.
// Preview deploys DO report — that's the point of preview environments.
const enabled = isProduction || env.NODE_ENV === 'preview';

Sentry.init({
  // Sentry parses the DSN even when disabled, so a placeholder value would
  // print "Invalid Sentry Dsn" on every dev boot. Withhold it entirely unless
  // we actually intend to report.
  dsn: enabled ? env.SENTRY_DSN || undefined : undefined,
  environment: env.NODE_ENV,
  tracesSampleRate: 1.0,
  enabled,

  // Strip common PII fields before events leave the server.
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies;
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }
    return event;
  },
});

export { Sentry };
