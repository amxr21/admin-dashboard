import { afterEach, describe, expect, it } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import { useBranchColumn } from '../useBranchColumn';

/**
 * Whether a list shows its Branch column (O1).
 *
 * ─── WHY THIS RULE IS WORTH A TEST OF ITS OWN ────────────────────────
 * It is conditional in BOTH directions, and each direction is wrong in a
 * different way:
 *
 * - Shown while a branch is selected: a column repeating the same value down
 *   every row, eating width the real data needs.
 * - Hidden on "All branches": rows from different shops sit next to each other
 *   with nothing to tell them apart — the exact gap the order detail page
 *   closed in #155 and every list still had.
 *
 * Three tables depend on it, so it is one hook rather than three copies of the
 * condition, and this is where the condition is actually pinned down.
 */

const BRANCH_KEY = 'admin-dashboard:branch';

function Probe() {
  return <span>{useBranchColumn() ? 'shown' : 'hidden'}</span>;
}

afterEach(() => {
  window.localStorage.removeItem(BRANCH_KEY);
});

describe('useBranchColumn', () => {
  it('shows the column when no branch is selected', async () => {
    // "All branches" is the default and a real choice, not an empty state.
    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText('shown')).toBeInTheDocument();
    });
  });

  it('hides the column when a branch is selected', async () => {
    window.localStorage.setItem(BRANCH_KEY, 'branch-1');

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText('hidden')).toBeInTheDocument();
    });
  });

  it('treats a blank stored value as no branch', async () => {
    // `readBranchId` trims to null rather than returning '' — otherwise an
    // empty string would read as "a branch is selected" and hide the column
    // on a page that is in fact showing every branch.
    window.localStorage.setItem(BRANCH_KEY, '   ');

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText('shown')).toBeInTheDocument();
    });
  });
});
