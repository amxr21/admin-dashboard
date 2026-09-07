'use client';

import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * "This click registered, the page is on its way."
 *
 * ─── WHY THIS EXISTS (F7.4) ──────────────────────────────────────────
 * `PageTransition` fades the NEW page in once it arrives. It does nothing
 * during the gap BEFORE that — so on a route that has to fetch (every report
 * page does), a click produced no feedback at all until the page was ready.
 * The nav item did not even look pressed, so the honest reading of the screen
 * was "nothing happened", and the natural response is to click again.
 *
 * ─── WHY `useLinkStatus` AND NOT LOCAL STATE ─────────────────────────
 * The obvious version is `onClick` → `setPending(true)`, which is wrong in
 * both directions: it stays spinning forever if the navigation is cancelled
 * or fails, and it shows nothing for a navigation the user started any other
 * way (browser back, a command-palette jump, a redirect). `useLinkStatus` is
 * scoped to the enclosing `<Link>` and is cleared by the router itself, so it
 * cannot outlive the navigation it describes.
 *
 * It MUST be rendered inside a `<Link>` — outside one it always reads
 * `pending: false`, which fails silently rather than loudly. That is why this
 * is a child component and not a hook call in the nav item.
 *
 * ─── WHY A DELAY ─────────────────────────────────────────────────────
 * A prefetched route resolves in a few milliseconds, and a spinner that
 * appears and vanishes within one frame reads as a flicker — visual noise
 * that makes the UI feel LESS stable, which is the opposite of the point.
 * CSS handles the delay so no timer, no state and no re-render is involved:
 * the element is always mounted while pending and simply stays transparent
 * until the animation's delay elapses.
 */
export function NavPendingIndicator({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <Loader2
      aria-hidden
      className={cn(
        'size-3.5 shrink-0 animate-spin',
        // Fades in only after 150ms, so a fast (prefetched) navigation never
        // flashes a spinner. `fill-mode: both` holds the opacity-0 start
        // state during the delay rather than showing it at full opacity first.
        'motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both motion-safe:delay-150',
        className,
      )}
    />
  );
}
