'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Last resort: an error in the ROOT layout itself.
 *
 * This REPLACES the root layout rather than nesting inside it, so it must
 * render its own <html> and <body> — and none of the app's providers exist
 * here. No next-intl, no theme, no fonts, and no guarantee the stylesheet
 * imported by the root layout was ever applied.
 *
 * Hence hardcoded English and inline styles. That is a deliberate downgrade,
 * not an oversight: a translated, Tailwind-styled error screen that itself
 * depends on the thing that just crashed leaves the user with a blank page.
 *
 * In practice this almost never renders — `[locale]/error.tsx` catches page
 * errors first and is the real user-facing experience. This exists so that the
 * one time the layout breaks, there is still a sentence on screen and a report
 * in Sentry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          margin: 0,
          padding: '2rem',
          textAlign: 'center',
          color: '#0f172a',
          background: '#ffffff',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
          The dashboard couldn&apos;t start
        </h1>
        <p style={{ margin: 0, maxWidth: '32rem', lineHeight: 1.6, color: '#475569' }}>
          Something failed while loading the page itself. The problem has been
          reported automatically. Trying again usually fixes it.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 1.25rem',
            borderRadius: '0.375rem',
            border: 'none',
            background: '#0f172a',
            color: '#ffffff',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Try again
        </button>
        {error.digest ? (
          <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
            Reference: <code style={{ fontFamily: 'monospace' }}>{error.digest}</code>
          </p>
        ) : null}
      </body>
    </html>
  );
}
