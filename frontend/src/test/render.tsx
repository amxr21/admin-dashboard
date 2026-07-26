import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

/**
 * Renders a component inside the providers it needs at runtime.
 *
 * Any component calling `useTranslations` throws without an intl provider, so
 * a plain `render()` from RTL fails with an error about missing context rather
 * than about the component. This wrapper keeps that noise out of every test.
 *
 * Passing `locale: 'ar'` also sets `dir="rtl"` on the document, so RTL
 * behaviour can be asserted without a separate setup step.
 */

const MESSAGES = { en, ar } as const;

type TestLocale = keyof typeof MESSAGES;

interface Options extends Omit<RenderOptions, 'wrapper'> {
  locale?: TestLocale;
}

export function render(ui: ReactElement, { locale = 'en', ...options }: Options = {}) {
  // Real components read direction from the document, not from React context —
  // see lib/direction.ts for why. Tests must set it the same way.
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    );
  }

  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

export * from '@testing-library/react';
