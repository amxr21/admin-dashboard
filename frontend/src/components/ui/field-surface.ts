/**
 * The shared visual surface for every form control.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────
 * Five controls sit side by side in a single filter bar — Input, Select,
 * Combobox, Textarea and the DatePicker's trigger — and before this they
 * disagreed on all three of the things a user actually perceives:
 *
 *   Input/Textarea  bg-card       focus-visible:ring-[3px] + border shift
 *   Select/Combobox bg-background focus:ring-2 ring-offset-2, border static
 *   DatePicker      bg-card       (inherits Button's ring-2 ring-offset-2)
 *
 * On the `#f6f7f9` canvas a `bg-background` control reads as faintly sunken
 * between two `bg-card` neighbours, and tabbing across a row changed the
 * focus animation three times. None of that was a decision; it accumulated.
 *
 * ─── THE INVALID STATE IS THE REAL BUG ───────────────────────────────
 * Only Input and Textarea carried `aria-invalid:` styling. `resource-form`
 * passes `aria-invalid` faithfully to Select, Combobox and DatePicker too —
 * and all three rendered completely unchanged. A required Select that failed
 * validation showed its message below the control while the control itself
 * looked untouched, which on a long form is below the fold.
 *
 * Putting the rule here means a control gains the state by ADOPTING the
 * surface, rather than by each one remembering to add it.
 *
 * ─── WHAT BELONGS HERE, AND WHAT DOES NOT ────────────────────────────
 * Only what every control shares: the box, the border, the fill, the focus
 * ring, the invalid treatment and the disabled treatment. Layout is the
 * control's own business — an Input needs `ps-3 pe-3`, a Select needs
 * `justify-between gap-2` for its chevron, a Textarea is not `h-8` at all.
 * Folding those in here would make this a second place to look for a
 * padding bug.
 *
 * `FIELD_SURFACE` is the common case. `FIELD_SURFACE_BOX` omits the height
 * for controls that size themselves (Textarea, and anything that grows with
 * its content).
 */

/** Border, fill, focus ring, invalid and disabled states — no height, no padding. */
export const FIELD_SURFACE_BOX = [
  'border-input bg-card text-foreground placeholder:text-muted-foreground',
  'w-full rounded-md border text-sm',
  'transition-[color,box-shadow] outline-none',
  // focus-VISIBLE, not focus: a Select opened by click should not paint a
  // ring the mouse user never asked for, and Radix forwards the same
  // attribute either way.
  'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  // The attribute, not a prop: `aria-invalid` is what assistive tech reads,
  // so styling from it keeps the visual and announced states from drifting.
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

/**
 * The same surface at the app's standard control height.
 *
 * `h-8` matches Button's default size (URG-012), so an input, a select and a
 * button on one form row line up without any call site adjusting for it.
 */
export const FIELD_SURFACE = `${FIELD_SURFACE_BOX} h-8`;
