/**
 * Motion design tokens. Every animation pulls timing, easing, and distance
 * from here, so the whole product feels like one system — the same reason
 * colours live in `globals.css` rather than being typed at each call site.
 *
 * NEVER inline a magic number like `duration: 0.37` in a component. Add a
 * token here and reference it. If a value doesn't fit an existing token, that
 * is a signal to discuss the token set, not to special-case one component.
 */

// ─── Durations (seconds) ──────────────────────────────────────────
// Frequent, small actions are fast; large transitions are slower. Anything
// above ~0.7s starts to feel like waiting rather than responding.
export const DURATION = {
  instant: 0.1, // toggles, checkbox ticks, tiny feedback
  fast: 0.2, // hovers, presses, small reveals
  base: 0.3, // the default: modals, dropdowns, list items
  slow: 0.5, // section reveals, larger panels
  slower: 0.7, // page transitions, first-load moments
} as const;

// ─── Easings ──────────────────────────────────────────────────────
// GSAP ease strings. `power2` is the workhorse; reach for the expressive ones
// deliberately, not by default.
export const EASE = {
  /** Decelerate. Correct for anything ENTERING the screen. */
  out: 'power2.out',
  /** Accelerate. Correct for anything LEAVING the screen. */
  in: 'power2.in',
  /** Both ends. For moves that start and stop on screen. */
  inOut: 'power2.inOut',

  /** Slight overshoot. Playful entrances — use sparingly in an admin tool. */
  backOut: 'back.out(1.7)',
  /** Dramatic decelerate. Hero moments only. */
  expoOut: 'expo.out',

  /** Linear. Only for continuous loops such as spinners. */
  none: 'none',
} as const;

// ─── Distances (pixels) ───────────────────────────────────────────
// How far an element travels when sliding in. Keep it subtle — long travel
// reads as sluggish, and in a data-dense dashboard it's actively distracting.
export const DISTANCE = {
  sm: 8, // micro-motion
  md: 16, // list rows, cards
  lg: 32, // page sections
  xl: 64, // full-page motion
} as const;

// ─── Stagger (seconds between siblings) ───────────────────────────
// Total stagger time grows with list length, so cap it: 50 rows at 0.05s each
// is 2.5 seconds of waiting. Prefer `amount` over `each` for long lists — see
// MOTION.md.
export const STAGGER = {
  tight: 0.03, // dense lists, table rows
  base: 0.06, // cards, tiles
  loose: 0.12, // a handful of large elements
} as const;

/**
 * The total wall-clock budget for any single stagger, regardless of item count.
 * GSAP's `stagger: { amount }` divides this across all items, so a 5-row table
 * and a 500-row table both finish in the same time.
 */
export const STAGGER_TOTAL_MAX = 0.4;

/**
 * What an animation becomes under `prefers-reduced-motion: reduce`.
 *
 * Reduced motion means *no travel*, not *no transition*. A short opacity fade
 * carries the "something changed here" signal without the vestibular problem
 * that movement causes — so content still doesn't appear out of nowhere.
 *
 * Never set this to a zero-duration no-op: an element that pops in instantly
 * is harder to follow than one that fades over 150ms.
 */
export const REDUCED = {
  duration: 0.15,
  ease: EASE.out,
  /** No movement, ever. This is the whole point. */
  distance: 0,
} as const;

export type Duration = keyof typeof DURATION;
export type Ease = keyof typeof EASE;
export type Distance = keyof typeof DISTANCE;
