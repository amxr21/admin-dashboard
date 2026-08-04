'use client';

import { useEffect, useState } from 'react';

/**
 * First-run welcome overlay: has this browser already seen it?
 *
 * Same `mounted`-guard shape as `useSidebarCollapse` and the same reason —
 * the server cannot know localStorage, so it always renders "not seen" and
 * the real value takes over after mount, with no hydration mismatch.
 *
 * Per-browser, not per-account: a shared machine (or a staff member using a
 * new laptop) should see it again, same as `sidebar-collapsed`. There is no
 * per-role variant of the content, so no server round-trip is worth adding
 * just to sync "have I seen the tour" across devices.
 */

const STORAGE_KEY = 'admin-dashboard:onboarding-welcome-seen';

export function useOnboardingWelcome() {
  const [seen, setSeenState] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setSeenState(window.localStorage.getItem(STORAGE_KEY) === 'true');
    setMounted(true);
  }, []);

  function dismiss() {
    setSeenState(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Private-mode storage can throw — worst case the overlay reappears
      // next visit, never worth failing the dismiss over.
    }
  }

  return {
    // Defaults to "seen" (closed) until mounted, so nothing flashes open
    // during SSR/hydration — only opens once the real stored value says no.
    shouldShow: mounted && !seen,
    dismiss,
  };
}
