'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Wraps next-themes, which owns the `.dark` class on <html>.
 *
 * Why a library rather than a useState toggle: the theme must be applied
 * BEFORE first paint, or every dark-mode user gets a white flash on each page
 * load. next-themes injects a tiny blocking script that reads localStorage and
 * sets the class before React hydrates. That is the entire value here.
 *
 * `attribute="class"` matches the `@custom-variant dark (&:is(.dark *))` rule
 * in globals.css — change one and you must change the other.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      /**
       * FALSE on purpose — this was `true` originally.
       *
       * With it enabled, next-themes suppresses all CSS transitions during the
       * switch, so the theme change is an instant flash across the page. The
       * reasoning then was that transitioning every token at once reads as a
       * smear.
       *
       * That holds for a long transition or a blanket `transition: all`.
       * globals.css instead transitions ONLY colour properties, over 200ms —
       * short enough to read as a single deliberate change rather than a
       * crossfade, and far better than a jolt. Reduced-motion users still get
       * an instant switch, handled in CSS.
       */
      disableTransitionOnChange={false}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
