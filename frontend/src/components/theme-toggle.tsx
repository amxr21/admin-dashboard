'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { gsap, useGSAP } from '@/lib/gsap';
import { DURATION, EASE } from '@/lib/motion-tokens';

/**
 * Light/dark toggle.
 *
 * The `mounted` guard is not optional. On the server there is no way to know
 * the user's stored theme, so rendering the "correct" icon during SSR
 * guarantees a hydration mismatch on every dark-mode load. Render a
 * same-sized placeholder until mounted, then swap — no mismatch, no layout
 * shift.
 *
 * The icon cross-fades and rotates rather than swapping instantly. The colour
 * transition of the page itself is handled in globals.css, so the two happen
 * together and the whole switch reads as one movement.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  useGSAP(
    () => {
      if (!mounted) return;

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // Rotation + scale, no travel — the button must not move, or the
        // pointer ends up somewhere the user didn't aim.
        gsap.from(iconRef.current, {
          rotate: -90,
          scale: 0.6,
          opacity: 0,
          duration: DURATION.fast,
          ease: EASE.backOut,
        });
      });

      // Under reduced motion the icon simply swaps. Rotation is exactly the
      // kind of movement this preference exists to avoid.
      return () => mm.revert();
    },
    { scope: iconRef, dependencies: [isDark, mounted] },
  );

  if (!mounted) {
    // Same footprint as the real button so nothing jumps when it appears.
    return <div className="size-9" aria-hidden />;
  }

  const label = isDark ? t('toLight') : t('toDark');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={label}
        >
          {/* Keyed so React remounts the span on change, which re-runs the tween.
              Neither icon is .icon-directional — a sun and a moon have no reading
              direction and must not mirror in RTL. */}
          <span key={isDark ? 'sun' : 'moon'} ref={iconRef} className="inline-flex">
            {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
