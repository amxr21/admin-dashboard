'use client';

import { usePathname } from 'next/navigation';
import { useLinkStatus } from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
 */

type Report = (delta: 1 | -1) => void;

const NavigationProgressContext = createContext<Report>(() => undefined);

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  const report = useCallback<Report>((delta) => {
    // A counter, not a boolean: two links can be pending at once (a fast
    // second click), and a boolean would clear on the first one settling.
    setPending((current) => Math.max(0, current + delta));
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
    setPending(0);
  }, [pathname]);

  const value = useMemo(() => report, [report]);

  return (
    <NavigationProgressContext.Provider value={value}>
      {children}
      <TransitionOverlay active={pending > 0} />
    </NavigationProgressContext.Provider>
  );
}

/**
 * Render INSIDE a `<Link>` to feed its pending state to the overlay.
 *
 * Renders nothing. It has to be a descendant of the Link because that is where
 * `useLinkStatus` reads from.
 */
export function NavigationPending() {
  const { pending } = useLinkStatus();
  const report = useContext(NavigationProgressContext);

  useEffect(() => {
    if (!pending) return;

    report(1);
    // The cleanup is what decrements — it runs when the link stops being
    // pending AND when it unmounts mid-navigation, so the count cannot leak.
    return () => report(-1);
  }, [pending, report]);

  return null;
}
