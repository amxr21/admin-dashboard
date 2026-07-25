'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Last-resort error boundary for the whole App Router tree.
 *
 * React swallows render errors into the nearest error boundary, so without
 * this file a crash in a Server or Client Component renders Next's default
 * error page and Sentry never hears about it. This is the only place that
 * catches errors thrown during rendering of the root layout itself.
 *
 * It must render <html> and <body> — it REPLACES the root layout rather than
 * nesting inside it.
 *
 * Note: per-route `error.tsx` boundaries are still worth adding as features
 * land. This one is the safety net, not the user-facing error experience.
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
      <body className="font-sans antialiased">
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm opacity-70">
            The error has been reported. Try again, and if it keeps happening
            quote this reference:{' '}
            <code className="font-mono">{error.digest ?? 'unknown'}</code>
          </p>
          <button
            type="button"
            onClick={reset}
            className="self-start rounded-md border px-4 py-2 text-sm"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
