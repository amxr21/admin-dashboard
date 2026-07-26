'use client';

import { usePathname } from 'next/navigation';
import { useRef, type ReactNode } from 'react';

import { gsap, useGSAP } from '@/lib/gsap';
import { DISTANCE, DURATION, EASE, REDUCED } from '@/lib/motion-tokens';

/**
 * Fades page content in on every route change.
 *
 * Wraps `{children}` in the locale layout, so it covers ordinary navigation
 * AND language switching — switching locale is a route change, which is why
 * it currently snaps.
 *
 * ─── WHY THIS IS ENTER-ONLY ───────────────────────────────────────────
 * A proper enter/exit pair needs the outgoing page to stay mounted while it
 * animates out. React and the App Router unmount it immediately on navigation,
 * so an exit animation would need the whole tree held in state and replayed —
 * a lot of machinery, and it delays every navigation by the exit duration.
 *
 * Enter-only costs nothing, can't make navigation feel slower, and gets most
 * of the perceived smoothness. Revisit with View Transitions once Next's
 * support settles.
 *
 * Keyed on `pathname` so React remounts it per route — that remount is what
 * re-runs the animation.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(ref.current, {
          opacity: 0,
          // Deliberately vertical, not horizontal. A y-offset needs no
          // direction handling, so it behaves identically in LTR and RTL —
          // and a page sliding sideways on every navigation gets tiring fast
          // in a tool people use all day.
          y: DISTANCE.sm,
          duration: DURATION.base,
          ease: EASE.out,
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.from(ref.current, {
          opacity: 0,
          duration: REDUCED.duration,
          ease: REDUCED.ease,
        });
      });

      return () => mm.revert();
    },
    // Re-runs on every route change, including a locale switch.
    { scope: ref, dependencies: [pathname] },
  );

  return <div ref={ref}>{children}</div>;
}
