'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { gsap } from '@/lib/gsap';

/**
 * Global motion control. Two jobs:
 *
 *   1. Respect the OS `prefers-reduced-motion` setting.
 *   2. Expose an in-app override, because plenty of people who need reduced
 *      motion don't know the OS setting exists — and some who set it globally
 *      still want motion in a tool they use all day.
 *
 * ─── WHY NOT timeScale(0) ─────────────────────────────────────────────
 * The obvious "master switch" is `gsap.globalTimeline.timeScale(0)`. It is
 * WRONG and it is an accessibility bug, not a stylistic choice.
 *
 * timeScale(0) FREEZES animations wherever they currently are. An element
 * tweening from `opacity: 0` to `1` freezes at 0 — invisible, permanently. So
 * the users who most need reduced motion get a page with missing content.
 *
 * The correct behaviour for reduced motion is "arrive at the final state
 * immediately", not "stop moving". A very high timeScale does exactly that:
 * every tween completes within a frame, elements land on their end values, and
 * nothing perceptibly animates.
 */

const MOTION_OFF_TIMESCALE = 200;
const STORAGE_KEY = 'admin-dashboard:motion-enabled';

interface MotionContextValue {
  /** False when motion should be suppressed, from OS preference or the toggle. */
  motionEnabled: boolean;
  setMotionEnabled: (enabled: boolean) => void;
  /** True once the OS preference has been read — before that, treat as unknown. */
  ready: boolean;
}

const MotionContext = createContext<MotionContextValue>({
  motionEnabled: true,
  setMotionEnabled: () => undefined,
  ready: false,
});

export function useMotion(): MotionContextValue {
  return useContext(MotionContext);
}

export function MotionProvider({ children }: { children: ReactNode }) {
  // Starts `true` to match what the server rendered. The effect below corrects
  // it on mount; starting `false` would mean a hydration mismatch on every load.
  const [motionEnabled, setMotionEnabledState] = useState(true);
  const [ready, setReady] = useState(false);

  // Read the OS preference, and keep listening — users do change it mid-session.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setReady(true);
      return;
    }

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');

    // An explicit in-app choice outranks the OS setting in both directions.
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setMotionEnabledState(stored === 'true');
    } else {
      setMotionEnabledState(!query.matches);
    }
    setReady(true);

    const onChange = (event: MediaQueryListEvent) => {
      // Only follow the OS if the user hasn't overridden it here.
      if (window.localStorage.getItem(STORAGE_KEY) === null) {
        setMotionEnabledState(!event.matches);
      }
    };

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Apply the master switch. See the note above on why this is a high
  // timeScale rather than 0.
  useEffect(() => {
    gsap.globalTimeline.timeScale(motionEnabled ? 1 : MOTION_OFF_TIMESCALE);
  }, [motionEnabled]);

  const setMotionEnabled = useCallback((enabled: boolean) => {
    setMotionEnabledState(enabled);
    // Persisted so the choice survives navigation and reloads. An admin tool
    // that forgets this setting every page load is worse than not offering it.
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  }, []);

  const value = useMemo(
    () => ({ motionEnabled, setMotionEnabled, ready }),
    [motionEnabled, setMotionEnabled, ready],
  );

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}
