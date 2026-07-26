'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES, type Locale } from '@/i18n/routing';

/**
 * Switches locale while STAYING ON THE CURRENT PAGE.
 *
 * `usePathname` from `@/i18n/navigation` returns the path without the locale
 * prefix, so replacing the locale keeps the user where they were. Using
 * `next/navigation`'s version instead would include the prefix and produce
 * `/ar/ar/orders`.
 *
 * Sending someone back to the home page when they change language is a small
 * thing that makes an app feel careless — especially on a deep page they took
 * several clicks to reach.
 */
export function LocaleSwitcher() {
  const t = useTranslations('language');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Two locales, so a toggle is right. Becomes a dropdown at three or more.
  const next: Locale = LOCALES.find((candidate) => candidate !== locale) ?? locale;

  function switchTo(target: Locale) {
    startTransition(() => {
      // `replace`, not `push`: switching language is not a navigation the user
      // should have to press Back through.
      router.replace(pathname, { locale: target });
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => switchTo(next)}
      disabled={isPending}
      // The label names the language being switched TO, not the current one —
      // less ambiguous for screen-reader users than a bare "Language".
      aria-label={t('switchTo', { language: t(next) })}
    >
      {/* Not `.icon-directional`: a globe/languages glyph has no direction. */}
      <Languages aria-hidden />
      <span>{t(next)}</span>
    </Button>
  );
}
