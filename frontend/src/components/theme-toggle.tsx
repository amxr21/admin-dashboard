'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Light/dark toggle.
 *
 * The `mounted` guard is not optional. On the server there is no way to know
 * the user's stored theme, so rendering the "correct" icon during SSR
 * guarantees a hydration mismatch on every dark-mode load. Render a
 * same-sized placeholder until mounted, then swap — no mismatch, no layout
 * shift.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Same footprint as the real button so nothing jumps when it appears.
    return <div className="size-9" aria-hidden />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
