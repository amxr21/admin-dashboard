'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Collapse/expand for the desktop sidebar rail.
 *
 * A personal, immediate, per-browser preference — NOT the store-wide
 * `ui.sidebarMode` setting (sticky vs. floating), which lives in the
 * settings registry and applies to every browser for every staff member.
 * This is the opposite: nobody else should see it change, and it should
 * apply instantly with no server round-trip — same spirit as
 * `theme-toggle.tsx`'s use of `next-themes` (localStorage, no DB row) and
 * `motion-provider.tsx`'s explicit-override pattern.
 *
 * The `mounted` guard mirrors theme-toggle.tsx for the same reason: the
 * server has no way to know the stored preference, so rendering the
 * "correct" (possibly collapsed) layout during SSR would guarantee a
 * hydration mismatch whenever the stored value is `true`. Callers render the
 * expanded (server-matching) layout until `mounted` flips, then the real
 * value takes over — no visible flash, no mismatch warning.
 */

const STORAGE_KEY = 'admin-dashboard:sidebar-collapsed';

export function useSidebarCollapse() {
  const [collapsed, setCollapsedState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCollapsedState(window.localStorage.getItem(STORAGE_KEY) === 'true');
    setMounted(true);
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Private-mode storage can throw. The preference simply doesn't
      // survive a reload in that case — never worth failing the toggle over.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return {
    // Reports "expanded" until mounted, matching what the server rendered.
    collapsed: mounted && collapsed,
    toggle,
    mounted,
  };
}
