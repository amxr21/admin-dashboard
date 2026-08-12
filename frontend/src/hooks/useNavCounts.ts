'use client';

import { useEffect, useState } from 'react';

import { canAccessArea, type StaffRole } from '@/config/areas';
import { fetchReturns } from '@/lib/returns-api';

/**
 * Sidebar nav badge counts — "Returns • 4" — answering "does this section
 * need my attention right now", the same question the top bar's
 * notification bell answers for notifications. Kept OUT of `NAVIGATION`
 * itself (config/navigation.ts): that list describes stable destinations,
 * not live counts, and a count that goes stale the moment you approve a
 * return has no business being baked into a static nav item.
 *
 * Same fetch-once + poll + focus-revalidate shape as `NotificationsBell`
 * (components/shell/notifications-bell.tsx) — one convention for "a live
 * count living in chrome that's visible from every page," not a second one
 * invented here.
 */

const POLL_INTERVAL_MS = 30_000;

export interface NavCounts {
  /** Returns awaiting approval (`status=REQUESTED`). `null` while loading or
   *  on a fetch failure — a badge with an unknown count doesn't render one,
   *  same "unknown and zero look the same" trade the bell makes. */
  returns: number | null;
}

export function useNavCounts(role: StaffRole): NavCounts {
  const [returns, setReturns] = useState<number | null>(null);
  const canSeeReturns = canAccessArea(role, 'returns');

  useEffect(() => {
    if (!canSeeReturns) {
      setReturns(null);
      return;
    }

    let cancelled = false;

    function refresh() {
      fetchReturns({ status: 'REQUESTED', pageSize: 1 })
        .then((result) => {
          if (!cancelled) setReturns(result.total);
        })
        .catch(() => {
          // A failing count must not break the sidebar on every page — see
          // NotificationsBell for the same call.
          if (!cancelled) setReturns(null);
        });
    }

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refresh();
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [canSeeReturns]);

  return { returns };
}
