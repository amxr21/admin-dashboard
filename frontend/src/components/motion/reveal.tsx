'use client';

import { useRef, type ReactNode } from 'react';

import { gsap, useGSAP } from '@/lib/gsap';
import { DISTANCE, DURATION, EASE, REDUCED } from '@/lib/motion-tokens';

/**
 * Fades its children in, with an optional slide, on mount. The most-used
 * motion primitive — most other animations in the app build on this shape.
 *
 * ```tsx
 * <Reveal><Card /></Reveal>
 * <Reveal direction="left" delay={0.1}><Heading /></Reveal>
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

type Direction = 'up' | 'down' | 'left' | 'right' | 'none';

interface RevealProps {
  children: ReactNode;
  /** Where the element travels FROM. Default 'up' (enters rising). */
  direction?: Direction;
  delay?: number;
  distance?: number;
  duration?: number;
  className?: string;
}

function offsetFor(direction: Direction, distance: number): gsap.TweenVars {
  switch (direction) {
    case 'up':
      return { y: distance };
    case 'down':
      return { y: -distance };
    case 'left':
      return { x: distance };
    case 'right':
      return { x: -distance };
    case 'none':
      return {};
  }
}

export function Reveal({
  children,
  direction = 'up',
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
          ...offsetFor(direction, distance),
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
