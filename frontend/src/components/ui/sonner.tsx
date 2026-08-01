'use client';

import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * shadcn/ui Sonner adapter, re-pointed at THIS project's semantic tokens
 * rather than sonner's own defaults — the same "never a raw color" rule
 * every other component in `ui/` follows. `--success`/`--warning`/`--info`
 * already exist in globals.css (see status-badge.tsx's tone map), so a toast
 * fired with `toast.success`/`toast.warning` reads consistently with every
 * badge and banner already in the app.
 */
function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const locale = useLocale();

  // Sonner's `position` is physical, not logical — there is no "bottom-end".
  // The stack anchors to the reading-END corner so it never sits under a
  // hand writing right-to-left, the same reasoning as the sidebar mirroring
  // by locale rather than a fixed side.
  const position: ToasterProps['position'] =
    locale === 'ar' ? 'bottom-left' : 'bottom-right';

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps['theme']}
      className="toaster group"
      position={position}
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--card-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--card)',
          '--success-text': 'var(--success)',
          '--success-border': 'var(--border)',
          '--error-bg': 'var(--card)',
          '--error-text': 'var(--destructive)',
          '--error-border': 'var(--border)',
          '--warning-bg': 'var(--card)',
          '--warning-text': 'var(--warning)',
          '--warning-border': 'var(--border)',
          '--info-bg': 'var(--card)',
          '--info-text': 'var(--info)',
          '--info-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
