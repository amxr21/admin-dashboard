'use client';

import { useEffect, useState } from 'react';

/**
 * The user's motion preference, kept in sync if they change the OS setting
 * mid-session.
 *
 * ```ts
 * const reduced = useReducedMotion();
 * const distance = reduced ? 0 : DISTANCE.lg;
 * ```
 *
 * Starts `false` deliberately. The server cannot know the preference, so it
 * must render the same value the client's first paint produces or React logs a
 * hydration mismatch. The effect corrects it immediately after mount — one
 * frame of motion for a reduced-motion user is a far better trade than a
 * hydration error on every page.
 *
 * For GSAP animations prefer `gsap.matchMedia()` (see MotionProvider), which
 * handles the preference at the animation level and reverts cleanly. Use THIS
 * hook for React-level decisions — whether to render a decorative component at
 * all, for instance.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // Guard for older browsers and for jsdom without a matchMedia polyfill —
    // absence of the API is not a reason to crash the app.
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
