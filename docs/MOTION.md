# Motion

How animation works in this app, and the rules that keep it consistent.

**Stack:** GSAP + `@gsap/react`. All GSAP plugins are free (Webflow released the
formerly Club-only ones in April 2025) — no licence key, commercial use fine.

---

## The five rules

### 1. Accessibility is not optional

Every animation must respect `prefers-reduced-motion`. Motion can cause nausea
and dizziness for people with vestibular disorders — this is a health issue, not
a preference.

Two mechanisms, and you need both:

- **`gsap.matchMedia()`** inside a component — swaps the animation for a
  reduced variant. See `components/motion/reveal.tsx`.
- **`MotionProvider`** — a global master switch, plus an in-app override,
  because plenty of people who need reduced motion don't know the OS setting
  exists.

**Reduced motion means no MOVEMENT, not no transition.** A short opacity fade
still signals "something changed here". An element that pops in with zero
duration is *harder* to follow, not easier. See the `REDUCED` token.

### 2. Animate only `transform` and `opacity`

These are GPU-composited. Animating `width`, `height`, `top`, `left`, or
`margin` triggers layout reflow on every frame and janks.

When a layout dimension genuinely must change — a grid reflowing, a row
expanding — use the **Flip** plugin, which measures start and end states and
animates the difference as a transform.

### 3. `useGSAP()`, never raw `gsap.to()` in an effect

`useGSAP` from `@gsap/react` handles cleanup, scoping, and the React lifecycle.
Raw GSAP in `useEffect` leaks animations on unmount and fights React's
rendering.

Always pass a scope so selectors can't escape the component:

```tsx
useGSAP(() => {
  gsap.from('.card', { opacity: 0 });   // scoped to ref, not the document
}, { scope: containerRef });
```

### 4. Tokens, never magic numbers

Durations, easings, distances and staggers come from `lib/motion-tokens.ts`.
No `duration: 0.37` at a call site. If a value doesn't fit an existing token,
that's a conversation about the token set — not a special case.

### 5. Motion has meaning

Animation directs attention and communicates state change. If everything moves,
nothing stands out. In a data-dense admin tool the bar for adding motion is
higher than on a marketing site — a table that animates on every keystroke is
actively worse than one that doesn't.

Fast for frequent actions (150–250ms), slower for large transitions (400–600ms).

---

## Two implementation traps, both hit while building this

### `timeScale(0)` is an accessibility bug

The obvious global "off switch" is `gsap.globalTimeline.timeScale(0)`. **Don't.**

It *freezes* animations wherever they are. An element tweening from
`opacity: 0` freezes at `0` — invisible, permanently. The users who most need
reduced motion get a page with missing content.

The provider uses a very high timeScale instead, so tweens complete within a
frame and elements land on their final values. There's a test that fails if
anyone changes it back.

### `gsap.from`, not `gsap.to`, for reveals

With `from`, the resting DOM state is the *final* state. If GSAP fails to load,
errors, or the component renders somewhere without it, the content is simply
visible.

With `to` starting from `opacity: 0`, that same failure leaves content invisible
forever. **Fail visible, never fail blank.**

---

## What exists now

| File | Purpose |
|---|---|
| `lib/gsap.ts` | Central plugin registration. Import `gsap`/`useGSAP` from here. |
| `lib/motion-tokens.ts` | Durations, easings, distances, staggers, `REDUCED`. |
| `hooks/useReducedMotion.ts` | React-level preference check. |
| `components/motion-provider.tsx` | Master switch + in-app override, persisted. |
| `components/motion/reveal.tsx` | Fade/slide in on mount. The base primitive. |

`ScrollTrigger` and `Flip` are registered. Others are one line in `lib/gsap.ts`,
but each is bundle weight — add them when something needs them.

---

## Long lists: cap the total, don't multiply per item

`stagger: 0.05` on 50 rows is 2.5 seconds before the last one appears. Use
GSAP's object form, which divides a fixed budget across however many items
there are:

```ts
gsap.from(rows, {
  opacity: 0,
  y: DISTANCE.md,
  duration: DURATION.base,
  stagger: { amount: STAGGER_TOTAL_MAX },   // total, not per-item
});
```

A 5-row table and a 500-row table then finish in the same time.

---

## Not built yet

Page transitions, modal/toast motion, skeletons, scroll reveals, and
micro-interactions all build on the primitives above. They arrive with the
components that need them (groups 5–7) rather than as speculative abstractions.
