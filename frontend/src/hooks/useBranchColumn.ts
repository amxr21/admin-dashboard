'use client';

import { useEffect, useState } from 'react';

import { readBranchId } from '@/lib/auth-storage';

/**
 * Should a list show a Branch column right now? (O1)
 *
 * ─── ONLY WHEN UNSCOPED ──────────────────────────────────────────────
 * With a branch selected in the switcher, every row on the page is from that
 * branch by construction — a column repeating the same value down every row
 * is noise, and it costs horizontal space the actual data needs.
 *
 * On "All branches" it is the opposite: rows from different shops sit next to
 * each other and are otherwise indistinguishable. That is the gap the order
 * DETAIL page closed in PR #155 and every list still had.
 *
 * Read in an effect rather than during render: `readBranchId` touches
 * `localStorage`, which does not exist on the server, and reading it in the
 * render body makes the first client paint disagree with the server's HTML.
 * Starting `false` means the column appears rather than disappears on hydrate,
 * which is the less jarring direction.
 */
export function useBranchColumn(): boolean {
  const [unscoped, setUnscoped] = useState(false);

  useEffect(() => {
    setUnscoped(readBranchId() === null);
  }, []);

  return unscoped;
}
