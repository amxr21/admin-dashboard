'use client';

/**
 * Reading direction, for JavaScript that has to know it.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────
 * CSS transforms do NOT respect `dir="rtl"`. `translateX(-100%)` slides left in
 * both directions — so a drawer that slides in correctly in English slides OFF
 * SCREEN in Arabic. Nothing errors; it just silently breaks.
 *
 * Anything animating along the x-axis must multiply its offset by `sign()`.
 * Prefer CSS logical properties (`inset-inline-start`) where the animation
 * allows it; use this when you need `transform` for compositor performance.
 */

export type Direction = 'ltr' | 'rtl';

/**
 * Reads the live direction from the DOM rather than from React context.
 *
 * Deliberate: GSAP callbacks and `useGSAP` bodies run outside React's render
 * cycle, so a context value read at render time can be stale by the time an
 * animation is built. `<html dir>` is always current.
 *
 * Returns 'ltr' during SSR, where there is no document. Animations only run on
 * the client, so this never produces a mismatch in practice.
 */
export function getDocumentDirection(): Direction {
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * `1` in LTR, `-1` in RTL. Multiply every x-offset by this.
 *
 * ```ts
 * gsap.from(el, { x: DISTANCE.md * directionSign() });
 * ```
 */
export function directionSign(): 1 | -1 {
  return getDocumentDirection() === 'rtl' ? -1 : 1;
}

/**
 * Maps a logical direction to a signed axis offset.
 *
 * 'start'/'end' are preferable to 'left'/'right' at call sites for the same
 * reason `padding-inline-start` beats `padding-left`: the intent survives a
 * direction change.
 */
export function inlineOffset(
  edge: 'start' | 'end',
  distance: number,
): number {
  const sign = directionSign();
  const offset = edge === 'start' ? distance * sign : -distance * sign;

  // `0 * -1` is -0 in JavaScript. Harmless for GSAP, but it fails `Object.is`
  // comparisons and serialises inconsistently — normalise it away rather than
  // leave a surprise for whoever writes the next equality check.
  return offset === 0 ? 0 : offset;
}
