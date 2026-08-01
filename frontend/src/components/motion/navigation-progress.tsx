'use client';

import { usePathname } from 'next/navigation';
import { useLinkStatus } from 'next/link';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { TransitionOverlay } from '@/components/motion/transition-overlay';

/**
 * Shows the transition overlay while a navigation is in flight.
 *
 * ─── WHY THIS IS NEEDED AT ALL ───────────────────────────────────────
 * The App Router keeps the CURRENT page interactive while the next one loads.
 * That is good for responsiveness, but nothing visibly happens between the
 * click and the new content — the UI looks frozen, then snaps. The page-enter
 * fade doesn't help: it only plays once the new page has already arrived, so
 * it covers the wrong half of the wait.
 *
 * `TransitionOverlay` already existed and already solved this, but it was
 * wired only to the language switcher. This connects it to ordinary
 * navigation.
 *
 * ─── WHY useLinkStatus AND NOT A GLOBAL CLICK LISTENER ───────────────
 * The common workaround is a document-level click handler that guesses a
 * navigation started. It misfires on modifier-clicks, downloads, external
 * links and same-page anchors, and it has no reliable "finished" signal.
 *
 * `useLinkStatus` is the framework telling us, per link, whether ITS
 * navigation is pending. No guessing, and it costs nothing when idle.
 *
 * ─── WHY THE OVERLAY NEEDS A LABEL, NOT JUST A COUNT ──────────────────
 * A bare "Loading…" tells the user something is happening but not what. The
 * label carries the destination — "Loading Orders…" — so the wait reads as
 * progress toward somewhere specific rather than a stall.
 *
 * Pending links are keyed by a per-instance id (not just counted), because
 * two links can be pending at once (a fast second click) and each may carry a
 * DIFFERENT label. Whichever reported most recently wins — it is the one the
 * user clicked last, so it is the destination they are actually waiting on.
 */

type Report = (id: string, active: boolean, label?: string) => void;

const NavigationProgressContext = createContext<Report>(() => undefined);

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const [pending, setPending] = useState<Map<string, string | undefined>>(() => new Map());

  const report = useCallback<Report>((id, active, label) => {
    setPending((current) => {
      const next = new Map(current);
      // A Map, not a counter: two links can be pending at once (a fast
      // second click), each keyed by its own instance so one settling never
      // clears the other's entry.
      if (active) next.set(id, label);
      else next.delete(id);
      return next;
    });
  }, []);

  const settledAt = useRef(pathname);

  /**
   * Arriving is the definitive end of every navigation. Without this a link
   * unmounting mid-flight — which the sidebar does when a group's visibility
   * changes — would leave the counter stuck above zero and the overlay up.
   *
   * The guard matters: React runs CHILD effects before parent effects, so on
   * mount `NavigationPending` increments first and an unguarded reset here
   * would immediately wipe it. Only an actual change of route is an arrival.
   */
  useEffect(() => {
    if (settledAt.current === pathname) return;

    settledAt.current = pathname;
    setPending(new Map());
  }, [pathname]);

  const value = useMemo(() => report, [report]);

  // The most recently reported label wins — Map insertion order puts it
  // last, so `.at(-1)` is whichever link the user clicked most recently.
  // `undefined` (an item with no label) falls back to the generic
  // `t('loading')` inside TransitionOverlay itself.
  const activeLabel = [...pending.values()].at(-1);

  return (
    <NavigationProgressContext.Provider value={value}>
      {children}
      <TransitionOverlay
        active={pending.size > 0}
        label={activeLabel ? t('loadingPage', { page: activeLabel }) : undefined}
      />
    </NavigationProgressContext.Provider>
  );
}

/**
 * Render INSIDE a `<Link>` to feed its pending state to the overlay.
 *
 * Renders nothing. It has to be a descendant of the Link because that is where
 * `useLinkStatus` reads from.
 */
interface NavigationPendingProps {
  /** The link's destination, shown as "Loading {label}…" while it resolves. */
  label?: string;
}

export function NavigationPending({ label }: NavigationPendingProps = {}) {
  const { pending } = useLinkStatus();
  const report = useContext(NavigationProgressContext);
  // Stable per mounted instance — lets two simultaneously pending links keep
  // independent entries in the provider's Map instead of colliding.
  const id = useId();

  useEffect(() => {
    if (!pending) return;

    report(id, true, label);
    // The cleanup is what clears it — it runs when the link stops being
    // pending AND when it unmounts mid-navigation, so no entry can leak.
    return () => report(id, false);
  }, [pending, report, id, label]);

  return null;
}
