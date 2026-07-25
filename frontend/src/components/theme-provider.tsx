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
      // Skip CSS transitions during the switch — otherwise every colour token
      // animates at once and the change reads as a smear rather than a flip.
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
