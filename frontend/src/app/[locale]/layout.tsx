import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ThemeProvider } from '@/components/theme-provider';
import { MotionProvider } from '@/components/motion-provider';
import { PageTransition } from '@/components/motion/page-transition';
import { getDirection, routing } from '@/i18n/routing';

import '../globals.css';

/**
 * Root layout. Lives under `[locale]` rather than at `app/` because `<html>`
 * needs the resolved locale for its `lang` and `dir` attributes, and those are
 * only known once that segment is parsed.
 *
 * Fonts are registered here, at setup. next/font self-hosts the files at build
 * time: no runtime request to Google, no layout shift from a late webfont, no
 * third-party tracking.
 *
 * TWO families, one per script. Arabic MUST have a real Arabic face — a
 * Latin-only font falls back to whatever the OS provides, which varies wildly
 * and usually looks poor. Both are exposed as CSS variables and selected by
 * `[lang]` in globals.css, so no component ever names a typeface.
 */

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-latin',
  display: 'swap',
});

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'admin-dashboard',
  description: 'Admin dashboard',
};

/** Pre-render both locales at build time rather than on first request. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // An unknown locale is a 404, not a silent fallback — otherwise `/de/orders`
  // would render English at a URL implying German.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for static rendering. Without it, every page opts into dynamic
  // rendering the moment it reads a translation.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={getDirection(locale)}
      className={`${inter.variable} ${arabic.variable}`}
      // next-themes sets class/style on <html> before hydration, so server and
      // client markup legitimately differ on this one element.
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground font-sans antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>
            <MotionProvider>
              {/* Covers ordinary navigation AND language switching — a locale
                  change is a route change, so without this it snaps. */}
              <PageTransition>{children}</PageTransition>
            </MotionProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
