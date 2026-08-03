import type { Metadata } from 'next';
import {
  Cairo,
  IBM_Plex_Sans_Arabic,
  Inter,
  Manrope,
  Noto_Sans_Arabic,
  Roboto,
  Tajawal,
  Work_Sans,
} from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ThemeProvider } from '@/components/theme-provider';
import { MotionProvider } from '@/components/motion-provider';
import { NavigationProgressProvider } from '@/components/motion/navigation-progress';
import { PageTransition } from '@/components/motion/page-transition';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/hooks/useAuth';
import { getDirection, routing } from '@/i18n/routing';
import { getBlockingAppearanceScript } from '@/lib/apply-appearance';

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
 * FOUR Latin/Arabic PAIRS, one per script each. Arabic MUST have a real Arabic
 * face — a Latin-only font falls back to whatever the OS provides, which
 * varies wildly and usually looks poor. Every pair gets its OWN pair of CSS
 * variables (`--font-latin-<key>` / `--font-arabic-<key>`); which pair is
 * ACTUALLY used is decided by `theme.fontFamily` re-pointing the generic
 * `--font-latin`/`--font-arabic` tokens via `[data-font-family]` in
 * globals.css — the same "re-point the inner variable, never the theme
 * token" rule `--primary`/`--radius` already follow (see apply-appearance.ts).
 * Registering all four here costs nothing at runtime: the browser only
 * fetches the @font-face files for whichever family is actually applied to
 * rendered text, never the other three.
 *
 * Static (non-variable) faces need every weight this app uses named
 * explicitly, or the browser synthesises a faux-bold/faux-medium — see the
 * 2026-07-27 error-log entry this comment used to warn about for the
 * previously-single Arabic face. Roboto and Tajawal have no true 600 weight
 * at all (a real gap in those families, not a registration mistake); `font-
 * semibold` synthesises slightly for those two only, an accepted trade-off
 * for offering them as an option.
 */

const interLatin = Inter({ subsets: ['latin'], variable: '--font-latin-default', display: 'swap' });
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['100', '200', '300', '400', '500', '600', '700'],
  variable: '--font-arabic-default',
  display: 'swap',
});

const manropeLatin = Manrope({ subsets: ['latin'], variable: '--font-latin-modern', display: 'swap' });
const cairoArabic = Cairo({ subsets: ['arabic'], variable: '--font-arabic-modern', display: 'swap' });

const workSansLatin = Work_Sans({ subsets: ['latin'], variable: '--font-latin-neutral', display: 'swap' });
const tajawalArabic = Tajawal({
  subsets: ['arabic'],
  weight: ['400', '500', '700'],
  variable: '--font-arabic-neutral',
  display: 'swap',
});

const robotoLatin = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-latin-classic',
  display: 'swap',
});
const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic-classic',
  display: 'swap',
});

const FONT_VARIABLES = [
  interLatin.variable,
  ibmPlexArabic.variable,
  manropeLatin.variable,
  cairoArabic.variable,
  workSansLatin.variable,
  tajawalArabic.variable,
  robotoLatin.variable,
  notoSansArabic.variable,
].join(' ');

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
      className={FONT_VARIABLES}
      // next-themes sets class/style on <html> before hydration, so server and
      // client markup legitimately differ on this one element.
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground font-sans antialiased">
        {/* Blocking, runs before hydration — same reasoning as next-themes'
            own script (see theme-provider.tsx): paints the last-known accent
            color/corner radius/density from localStorage immediately, so a
            reload doesn't flash default appearance while SettingsProvider's
            fetch is in flight. No-ops (and does nothing harmful) on a first
            visit with no cache yet. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: getBlockingAppearanceScript() }}
        />
        <NextIntlClientProvider>
          <ThemeProvider>
            <MotionProvider>
              {/* AuthProvider sits inside the intl provider so its error
                  states can be translated, and outside the page so the
                  session survives navigation. */}
              <AuthProvider>
                {/* One provider for the whole app — centralises
                    `delayDuration` and is what lets the pointer move between
                    two adjacent tooltip triggers (e.g. two collapsed sidebar
                    icons) without re-waiting for the second one. */}
                <TooltipProvider delayDuration={200}>
                  {/* NavigationProgress covers the wait BEFORE the new page
                      arrives; PageTransition fades it in once it has. The two
                      halves of the same navigation — neither covers the
                      other's half on its own. */}
                  <NavigationProgressProvider>
                    {/* Covers ordinary navigation AND language switching — a
                        locale change is a route change, so without this it
                        snaps. */}
                    <PageTransition>{children}</PageTransition>
                  </NavigationProgressProvider>
                  <Toaster />
                </TooltipProvider>
              </AuthProvider>
            </MotionProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
