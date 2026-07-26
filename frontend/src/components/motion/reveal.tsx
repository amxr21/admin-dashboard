'use client';

import { useRef, type ReactNode } from 'react';

import { gsap, useGSAP } from '@/lib/gsap';
import { inlineOffset } from '@/lib/direction';
import { DISTANCE, DURATION, EASE, REDUCED } from '@/lib/motion-tokens';

/**
 * Fades its children in, with an optional slide, on mount. The most-used
 * motion primitive — most other animations in the app build on this shape.
 *
 * ```tsx
 * <Reveal><Card /></Reveal>
 * <Reveal from="start" delay={0.1}><Heading /></Reveal>
 * ```
 *
 * Reduced motion is handled by `gsap.matchMedia`, which swaps the animation
 * rather than skipping it: a short opacity fade, no travel. See REDUCED in
 * motion-tokens.
 *
 * Uses `gsap.from`, not `gsap.to`, deliberately. With `from`, the resting DOM
 * state is the FINAL state — so if GSAP fails to load, errors, or the component
 * renders in an environment without it, the content is simply visible. With
 * `to` from `opacity: 0`, the same failure leaves the content invisible
 * forever. Fail visible, never fail blank.
 */

/**
 * Where the element travels FROM.
 *
 * Horizontal values are LOGICAL, not physical: 'start' means the reading-start
 * edge — left in English, right in Arabic. Physical 'left'/'right' are
 * deliberately not offered, because a hardcoded x-offset animates from the
 * wrong side in RTL and does so silently.
 */
type RevealFrom = 'up' | 'down' | 'start' | 'end' | 'none';

interface RevealProps {
  children: ReactNode;
  /** Default 'up' (enters rising). */
  from?: RevealFrom;
  delay?: number;
  distance?: number;
  duration?: number;
  className?: string;
}

function offsetFor(from: RevealFrom, distance: number): gsap.TweenVars {
  switch (from) {
    case 'up':
      return { y: distance };
    case 'down':
      return { y: -distance };
    // Signed by reading direction. CSS transforms ignore dir="rtl", so this is
    // the only thing standing between an Arabic user and content sliding in
    // from the wrong edge.
    case 'start':
      return { x: inlineOffset('start', distance) };
    case 'end':
      return { x: inlineOffset('end', distance) };
    case 'none':
      return {};
  }
}

export function Reveal({
  children,
  from = 'up',
  delay = 0,
  distance = DISTANCE.md,
  duration = DURATION.base,
  className,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(ref.current, {
          opacity: 0,
          ...offsetFor(from, distance),
          duration,
          delay,
          ease: EASE.out,
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.from(ref.current, {
          opacity: 0,
          duration: REDUCED.duration,
          delay,
          ease: REDUCED.ease,
        });
      });

      // revert() removes the inline styles GSAP added AND kills the matchMedia
      // listeners. Without it, a remounted component inherits stale transforms.
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
