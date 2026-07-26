import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { ThemeProvider } from '@/components/theme-provider';
import { MotionProvider } from '@/components/motion-provider';

import './globals.css';

/**
 * Fonts are registered here, at setup, rather than being added later.
 *
 * next/font self-hosts the files at build time: no request to Google at
 * runtime, no layout shift from a late-loading webfont, no third-party
 * tracking. The CSS variable is consumed by --font-sans in globals.css, so
 * components use `font-sans` and never name a typeface directly.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'admin-dashboard',
  description: 'Admin dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required by next-themes: its blocking script
    // sets the `class` and `style` on <html> before React hydrates, so the
    // server and client markup legitimately differ on this one element.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="bg-background text-foreground font-sans antialiased">
        <ThemeProvider>
          <MotionProvider>{children}</MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
