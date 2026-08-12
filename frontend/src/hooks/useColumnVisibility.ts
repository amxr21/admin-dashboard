'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Which columns are shown, per table, persisted per browser — same
 * localStorage-scoped-by-table-id shape as `useTableDensity`.
 *
 * A column is visible unless its id is explicitly listed as hidden. That
 * direction matters: a table's column SET can grow over time (a new field
 * added to `admin.config.ts`, a new field on a bespoke table) and a stored
 * allowlist would silently hide every column that didn't exist yet when the
 * preference was saved. A denylist means a newly added column is visible by
 * default, which is the behaviour someone actually wants — "hide the columns
 * I don't care about" — rather than "show only the columns I remembered to
 * opt into".
 */

const STORAGE_PREFIX = 'admin-dashboard:hidden-columns:';

function storageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`;
}

function parseStored(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function useColumnVisibility(tableId: string) {
  const [hidden, setHiddenState] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setHiddenState(parseStored(window.localStorage.getItem(storageKey(tableId))));
    setMounted(true);
  }, [tableId]);

  const persist = useCallback(
    (next: Set<string>) => {
      try {
        if (next.size === 0) window.localStorage.removeItem(storageKey(tableId));
        else window.localStorage.setItem(storageKey(tableId), JSON.stringify([...next]));
      } catch {
        // Private-mode storage can throw. The preference simply doesn't
        // survive a reload in that case — never worth failing the toggle over.
      }
    },
    [tableId],
  );

  const toggle = useCallback(
    (columnId: string, visible: boolean) => {
      setHiddenState((current) => {
        const next = new Set(current);
        if (visible) next.delete(columnId);
        else next.add(columnId);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setHiddenState(new Set());
    persist(new Set());
  }, [persist]);

  return {
    // Reports "nothing hidden" until mounted, matching what the server
    // rendered — same hydration-mismatch guard as useSidebarCollapse.
    hiddenColumns: mounted ? hidden : new Set<string>(),
    toggle,
    reset,
  };
}
