'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { gsap, useGSAP } from '@/lib/gsap';
import { DURATION, EASE, REDUCED } from '@/lib/motion-tokens';

/**
 * Full-screen backdrop shown while a navigation is pending.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────
 * React's `startTransition` keeps the CURRENT page interactive while the next
 * one loads. That's good for responsiveness, but it means nothing visibly
 * happens between click and new content — the UI looks frozen, then snaps.
 *
 * A page-enter animation doesn't help: it only plays once the new page has
 * already arrived, so it covers the wrong half of the wait.
 *
 * Switching language is the clearest case — the whole document re-renders in
 * another script and direction, and without this it's an unexplained jump.
 */

interface TransitionOverlayProps {
  active: boolean;
  /** Overrides the default "Loading…" label. */
  label?: string;
}

/**
 * Below this, showing a loader is worse than showing nothing — it flashes and
 * reads as a glitch. Most locale switches on a warm cache land under it.
 */
const SHOW_AFTER_MS = 120;

export function TransitionOverlay({ active, label }: TransitionOverlayProps) {
  const t = useTranslations('common');
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [active]);

  useGSAP(
    () => {
      if (!visible) return;

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(ref.current, {
          opacity: 0,
          duration: DURATION.fast,
          ease: EASE.out,
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.from(ref.current, { opacity: 0, duration: REDUCED.duration });
      });

      return () => mm.revert();
    },
    { scope: ref, dependencies: [visible] },
  );

  if (!visible) return null;

  return (
    <div
      ref={ref}
      // `status` + `aria-live` so a screen reader announces the wait rather
      // than going silent. `polite` because it must not interrupt.
      role="status"
      aria-live="polite"
      className={[
        'fixed inset-0 z-50 flex items-center justify-center',
        // Semi-transparent so the user keeps their place in the page rather
        // than staring at a blank screen.
        'bg-background/70 backdrop-blur-[2px]',
      ].join(' ')}
    >
      <div className="bg-card text-card-foreground flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg">
        {/* animate-spin, not GSAP: a continuous loop needs no orchestration,
            and CSS keeps it off the JS thread. Not .icon-directional — a
            spinner has no reading direction. */}
        <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
        <span className="text-sm font-medium">{label ?? t('loading')}</span>
      </div>
    </div>
  );
}
