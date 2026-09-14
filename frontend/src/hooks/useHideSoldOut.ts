'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the till's product grid hides sold-out items (F-POS).
 *
 * ─── WHY THIS IS A CHOICE AND NOT A FIXED BEHAVIOUR ──────────────────
 * The grid has always SHOWN sold-out products as disabled tiles with a badge,
 * deliberately: a tile that vanishes once it sells out leaves a cashier unable
 * to tell a customer "we just ran out of X" apart from "we never had X". That
 * reasoning still holds and is why this defaults to OFF.
 *
 * But a shop with a long tail of out-of-stock lines ends up with a grid where
 * most tiles cannot be tapped, and the owner asked for those gone. Both
 * readings are legitimate and they belong to different shops on different
 * days, so this is a control rather than a reversal.
 *
 * ─── PER-BROWSER, LIKE DENSITY AND SIDEBAR COLLAPSE ──────────────────
 * Not a settings-registry entry: "I am scanning a full grid right now" is a
 * personal, immediate preference, the same category as `useSidebarCollapse`
 * and `useTableDensity`. A store-wide setting would need a round trip and
 * would change the till for every cashier at once, which is not what was
 * asked for.
 *
 * The `mounted` guard mirrors `useSidebarCollapse` for the same reason: the
 * server cannot know the stored value, so rendering the filtered grid during
 * SSR would guarantee a hydration mismatch for anyone who had turned it on.
 * Callers get the unfiltered (server-matching) grid until `mounted` flips.
 */

const STORAGE_KEY = 'admin-dashboard:pos-hide-sold-out';

export function useHideSoldOut() {
  const [hide, setHideState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      setHideState(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // Private-mode storage throws on read in some browsers. Defaulting to
      // "show everything" is the safe direction: a cashier who cannot see a
      // product cannot sell it, whereas an extra disabled tile costs nothing.
    }
    setMounted(true);
  }, []);

  const setHide = useCallback((value: boolean) => {
    setHideState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // The choice still applies to this session; it just will not survive a
      // reload. Never worth failing the toggle over.
    }
  }, []);

  return {
    // Reports "show everything" until mounted, matching what the server
    // rendered — see the note above on hydration.
    hideSoldOut: mounted && hide,
    setHideSoldOut: setHide,
    mounted,
  };
}
