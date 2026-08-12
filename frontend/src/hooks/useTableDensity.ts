'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Per-table row density (comfortable / compact), overriding the store-wide
 * `ui.density` setting for ONE table.
 *
 * The global setting (`apply-appearance.ts`, `[data-density]` on `<html>`)
 * answers "what should every table look like by default for this store".
 * This answers a different question: "I'm scanning 200 rows of inventory
 * right now and want more of them on screen" — a personal, per-browser,
 * per-table preference, same category as `useSidebarCollapse`'s collapse
 * state. Persisted per table id so a choice made on Orders doesn't silently
 * change how Inventory looks.
 *
 * `null` (the default) means "inherit the global setting" — NOT "comfortable".
 * A table that has never had its density touched must keep tracking whatever
 * `ui.density` says, including if an owner changes it later; only an
 * explicit per-table choice should pin it locally and stop following.
 */

export type Density = 'comfortable' | 'compact';

const STORAGE_PREFIX = 'admin-dashboard:table-density:';

function storageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`;
}

export function useTableDensity(tableId: string) {
  const [override, setOverrideState] = useState<Density | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey(tableId));
    setOverrideState(stored === 'compact' || stored === 'comfortable' ? stored : null);
    setMounted(true);
    // Re-reads when the table identity changes — a page that renders
    // different DataTables under the same component (unlikely here, but the
    // resource table swaps `schema.resource`) must not carry the previous
    // table's override into the new one.
  }, [tableId]);

  const setOverride = useCallback(
    (value: Density | null) => {
      setOverrideState(value);
      try {
        if (value) window.localStorage.setItem(storageKey(tableId), value);
        else window.localStorage.removeItem(storageKey(tableId));
      } catch {
        // Private-mode storage can throw. The preference simply doesn't
        // survive a reload in that case — never worth failing the toggle over.
      }
    },
    [tableId],
  );

  return {
    // Reports "inherit" (null) until mounted, matching what the server
    // rendered — same hydration-mismatch guard as useSidebarCollapse.
    override: mounted ? override : null,
    setOverride,
  };
}
