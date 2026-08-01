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
  const [rendered, setRendered] = useState(false);

  // Show only if the transition survives past the anti-flash threshold.
  useEffect(() => {
    if (!active) return;

    const timer = setTimeout(() => setRendered(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [active]);

  /**
   * Enter AND exit are both animated here, imperatively, rather than the
   * overlay vanishing the instant `active` goes false. Before this, the
   * moment a navigation settled the overlay just disappeared — a hard cut —
   * and the new page's OWN fade-in (`PageTransition`) started a beat later,
   * underneath nothing. Two separate motions read as a stutter. Fading this
   * out while the new content fades in makes the whole page-change read as
   * one continuous crossfade instead.
   */
  useGSAP(
    () => {
      if (!ref.current) return;

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (!active) {
        if (!rendered) return;

        gsap.to(ref.current, {
          opacity: 0,
          duration: reduced ? REDUCED.duration : DURATION.fast,
          ease: EASE.in,
          onComplete: () => setRendered(false),
        });
        return;
      }

      gsap.fromTo(
        ref.current,
        { opacity: 0 },
        {
          opacity: 1,
          duration: reduced ? REDUCED.duration : DURATION.fast,
          ease: EASE.out,
        },
      );
    },
    { scope: ref, dependencies: [active, rendered] },
  );

  if (!rendered) return null;

  return (
    <div
      ref={ref}
      // `status` + `aria-live` so a screen reader announces the wait rather
      // than going silent. `polite` because it must not interrupt.
      role="status"
      aria-live="polite"
      className={[
        'fixed inset-0 z-50 flex items-center justify-center',
        /**
         * BLUR the page, don't wash it out.
         *
         * This was `bg-background/70` with a 2px blur — 70% opacity of the
         * page background is close enough to opaque that it read as a white
         * flash, and 2px of blur is invisible underneath it. The effect was a
         * blink rather than a state.
         *
         * Now the tint is light and the blur does the work: the layout stays
         * legible underneath, so the user keeps their place and can see that
         * the SAME page is busy rather than that a new blank one arrived.
         */
        'bg-background/30 backdrop-blur-md',
        // The blur itself is the transition — fading it in avoids a hard
        // snap from sharp to blurred.
        'transition-[backdrop-filter] duration-200',
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
