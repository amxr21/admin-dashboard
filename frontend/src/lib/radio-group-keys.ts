/**
 * Arrow keys for a WAI-ARIA radio group: which way a keypress moves the
 * selection, in reading order.
 *
 * Shared by `SegmentedControl` and `ChoiceCards` so the two single-choice
 * pickers can never disagree about keyboard behaviour.
 *
 * Left/right are resolved through the text direction, never hard-coded:
 * "next" is always the next option in reading order, so ArrowLeft moves
 * forward in Arabic. Up/down are direction-free.
 */
export function radioArrowStep(key: string, isRtl: boolean): -1 | 1 | null {
  switch (key) {
    case 'ArrowRight':
      return isRtl ? -1 : 1;
    case 'ArrowLeft':
      return isRtl ? 1 : -1;
    case 'ArrowDown':
      return 1;
    case 'ArrowUp':
      return -1;
    default:
      return null;
  }
}
