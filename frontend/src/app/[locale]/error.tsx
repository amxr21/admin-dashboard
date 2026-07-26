'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import * as Sentry from '@sentry/nextjs';

import { ErrorScreen } from '@/components/errors/error-screen';

/**
 * Catches any error thrown while rendering a page in this segment.
 *
 * Without this file Next.js shows its own error screen — a stack trace in
 * development and a bare "Application error" in production. Neither tells a
 * visitor anything useful, and the production one looks like the app died.
 *
 * The error is reported to Sentry here rather than left to the global handler,
 * because a render error caught by a boundary never reaches `window.onerror`.
 */
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errorPages.unexpected');

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorScreen
      title={t('title')}
      description={t('description')}
      // The digest is Next.js's server-side error id. In production the real
      // message is withheld from the browser on purpose, so this is the only
      // thread back to what actually happened.
      reference={error.digest}
      onRetry={reset}
    />
  );
}
