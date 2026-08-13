'use client';

import { useEffect } from 'react';

/**
 * Warns before the browser discards a dirty form — tab close, reload,
 * typing a new URL, or clicking an external/bookmark link. None of those
 * are Next.js navigations, so nothing React-level runs on the way out;
 * `beforeunload` is the one platform hook that can still intervene.
 *
 * ─── SCOPE: TAB/WINDOW CLOSE, NOT IN-APP NAVIGATION ──────────────────────
 * Clicking a sidebar `Link` while this form is dirty is NOT covered — the
 * App Router removed the Pages Router's `router.events`, and there is no
 * built-in way to intercept a client-side navigation before it commits.
 * Building that properly needs a Link-click interceptor with real edge
 * cases (must not double-prompt a Sheet that already guards its own close —
 * see resource-form.tsx's `requestClose` — and must not fire for navigation
 * AWAY from a page whose dirty state was just resolved). Flagged as
 * separate follow-up work, not attempted here.
 *
 * ─── WHY THE LISTENER IS ADDED/REMOVED ON EVERY `isDirty` CHANGE ─────────
 * A stale closure over `isDirty=true` would keep warning after the form
 * became clean again — the effect re-runs specifically so the listener
 * always reflects the CURRENT dirty state, not the state at mount.
 */
export function useUnsavedChangesGuard(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      // Chrome ignores a custom message and shows its own generic text;
      // other browsers vary. `preventDefault` (and the legacy
      // `returnValue` assignment) is what actually triggers the prompt —
      // the string itself is mostly vestigial at this point, but setting
      // it is still the documented way to opt in everywhere.
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);
}
