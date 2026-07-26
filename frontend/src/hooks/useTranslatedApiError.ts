'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { ApiError } from '@/lib/api';

/**
 * Turns a caught error into a message that tells the user what to DO.
 *
 * Collapsing every failure into "something went wrong" makes a recoverable
 * problem read as a broken app: an expired session needs a sign-in, a network
 * drop needs a retry, and a 403 needs neither. Those are three different
 * actions, so they get three different messages.
 *
 * `login-form.tsx` keeps its own mapping — it has auth-specific cases (locked
 * account, access ended) that only make sense on that screen. This hook is the
 * general one for everything else.
 */
export function useTranslatedApiError(): (error: unknown) => string {
  const t = useTranslations('states.error');

  return useCallback(
    (error: unknown): string => {
      // fetch REJECTS on an unreachable network rather than resolving with a
      // status, so a non-ApiError here is almost always connectivity.
      if (!(error instanceof ApiError)) return t('network');

      switch (error.status) {
        case 401:
          return t('unauthorized');
        case 403:
          return t('forbidden');
        case 404:
          return t('notFound');
        case 413:
          return t('tooLarge');
        default:
          return t('server');
      }
    },
    [t],
  );
}
