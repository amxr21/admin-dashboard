# Motion system

Motion in this dashboard communicates navigation, loading and state changes. It stays restrained
because users work in these screens repeatedly and dense data must remain the focus.

## Shared contract

- Use `DURATION`, `EASE`, `DISTANCE` and stagger limits from
  `frontend/src/lib/motion-tokens.ts`; do not add component-specific timing values.
- React/GSAP animation uses the registered `gsap` and `useGSAP` exports from
  `frontend/src/lib/gsap.ts`. Scope animations to a ref and clean up match-media contexts.
- Animate opacity and transforms. Use CSS color transitions for themes. Avoid animated layout
  dimensions, `transition: all`, and long route exit animations.
- Page navigation uses an enter-only vertical fade. Pending work uses visible loading feedback
  after 120 ms, while branch switching shows its explanatory full-page overlay immediately.
- Dialogs, drawers, popovers and tooltips use the shared shadcn primitives. Drawer direction is
  logical: start/end motion mirrors correctly in Arabic.
- Lists with unknown length must cap total stagger time. Content must remain visible if animation
  code fails to load.

## Reduced motion

The OS `prefers-reduced-motion` setting is respected by default. Each user can override it under
Settings → Your preferences → Animations. The choice is stored locally and applied before React
hydrates through `getBlockingMotionScript()`.

`MotionProvider` accelerates GSAP to its final state instead of freezing the global timeline.
The `data-motion="reduced"` attribute suppresses CSS travel and continuous animation. Never set
the GSAP timeline scale to zero because elements entering from opacity zero would remain hidden.

## Review checklist

- Verify pending navigation gives feedback without flashing on warm-cache routes.
- Verify content enters vertically and identically in LTR and RTL.
- Verify dialogs/drawers animate in and out, retain focus, and use the correct logical edge.
- Verify the theme switch transitions only color and radius properties.
- Test with OS reduced motion and the in-app override in both directions.
- Check mobile (375 px), tablet (768 px) and desktop (1440 px) for overflow and 44 px touch targets.
- Keep frequent actions within 150–250 ms and larger surfaces within 300–500 ms.
