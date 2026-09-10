import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import { useTranslatedApiError } from '../useTranslatedApiError';
import { ApiError } from '@/lib/api';

function wrapper(locale: 'en' | 'ar') {
  return function IntlWrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe('useTranslatedApiError actionable reasons', () => {
  it('turns a stable branch reason into actionable English', () => {
    const { result } = renderHook(() => useTranslatedApiError(), { wrapper: wrapper('en') });
    const error = new ApiError(400, 'BAD_REQUEST', 'internal wording', undefined, {
      field: 'branchId',
      reason: 'BRANCH_REQUIRED_MULTIPLE_BUSINESSES',
    });

    expect(result.current(error)).toBe(
      'Choose the branch where you are working, then start the shift again.',
    );
  });

  it('uses the Arabic catalogue for the same server reason', () => {
    const { result } = renderHook(() => useTranslatedApiError(), { wrapper: wrapper('ar') });
    const error = new ApiError(400, 'BAD_REQUEST', 'internal wording', undefined, {
      reason: 'BRANCH_REQUIRED_MULTIPLE_ASSIGNMENTS',
    });

    expect(result.current(error)).toContain('حسابك معيّن لأكثر من فرع');
  });

  it('keeps unexpected server failures generic', () => {
    const { result } = renderHook(() => useTranslatedApiError(), { wrapper: wrapper('en') });
    expect(result.current(new ApiError(500, 'INTERNAL', 'database details')))
      .toBe('The server had a problem. Try again in a moment.');
  });
});
