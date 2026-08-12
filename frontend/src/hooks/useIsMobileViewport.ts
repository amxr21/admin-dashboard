'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the viewport is below the table→card breakpoint.
 *
 * Same shape as `useReducedMotion`, and for the same reason: a CSS-only
 * `hidden md:block` / `md:hidden` pair looks correct in a real browser but
 * renders BOTH variants into the DOM simultaneously under jsdom, which has no
 * viewport and never evaluates the media query — every test querying table
 * content by text then finds two matches instead of one. This hook makes the
 * choice in React instead, so exactly one variant ever mounts.
 *
 * Queried as `(max-width: …)`, NOT `(min-width: …)` — deliberately. This
 * project's global test setup (`vitest.setup.ts`) stubs `matchMedia` to
 * report `matches: false` for every query when a test doesn't mock it
 * explicitly. A `min-width` query under that stub would evaluate to "does
 * NOT match the desktop width" → mobile, which is backwards: every existing
 * table test (dozens of files, not just this one) would suddenly render the
 * card path and every `getByRole('columnheader', …)`/text query written
 * against the table would break. `max-width` under the same false-by-default
 * stub resolves the safe way instead: "not below the breakpoint" → desktop,
 * so every existing test keeps working unchanged and only a test that
 * explicitly wants the mobile path needs `mockMatchMedia(true)`.
 */
const MOBILE_QUERY = '(max-width: 767px)'; // one px under Tailwind's `md`

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(MOBILE_QUERY);
    setIsMobile(query.matches);

    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
