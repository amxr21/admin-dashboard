import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { Toaster } from '@/components/ui/sonner';
import { ShiftControl } from '../shift-control';
import type { Shift } from '@/lib/shifts-api';

/**
 * Clocking on and off from the shell (F6.3).
 *
 * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
 * The open shift is SERVER state. It has to survive a reload, be identical in
 * a second tab, and be readable by a manager asking "who is on now" — so the
 * component must read it from the API and never from `localStorage`, where
 * two tabs could disagree and a cleared cache would lose worked hours.
 *
 * The other risk is the first paint: showing "Start shift" to somebody who is
 * already on shift invites a click that 409s.
 */

const { fetchMyShift, startShift, endShift } = vi.hoisted(() => ({
  fetchMyShift: vi.fn(),
  startShift: vi.fn(),
  endShift: vi.fn(),
}));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchMyShift,
  startShift,
  endShift,
}));

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    // Two hours ago, so the label is a stable "2:00".
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endedAt: null,
    originalStartedAt: null,
    originalEndedAt: null,
    editReason: null,
    editedAt: null,
    note: null,
    user: { id: 'u1', name: 'Sami', email: 'sami@example.test' },
    branch: { id: 'b1', name: 'Marina' },
    openedBy: { id: 'u1', name: 'Sami', email: 'sami@example.test' },
    editedBy: null,
    wasEdited: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('when nobody is on shift', () => {
  it('offers to start one', async () => {
    fetchMyShift.mockResolvedValue(null);

    render(<ShiftControl />);

    expect(await screen.findByRole('button', { name: /start shift/i })).toBeInTheDocument();
  });

  it('starts a shift and shows the running clock', async () => {
    fetchMyShift.mockResolvedValue(null);
    startShift.mockResolvedValue(makeShift());

    render(
      <>
        <ShiftControl />
        <Toaster />
      </>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /start shift/i }));

    await waitFor(() => {
      expect(startShift).toHaveBeenCalled();
    });
    expect(await screen.findByText('2:00')).toBeInTheDocument();
  });
});

describe('when a shift is already open', () => {
  it('reads the open shift from the SERVER, not local storage', async () => {
    // The whole point: a reload or a second tab must show the same state, and
    // "who is on now" is a question the server answers.
    fetchMyShift.mockResolvedValue(makeShift());

    render(<ShiftControl />);

    expect(await screen.findByText('2:00')).toBeInTheDocument();
    expect(fetchMyShift).toHaveBeenCalled();
    // Nothing about the shift was written locally, so nothing can go stale.
    expect(JSON.stringify(window.localStorage)).not.toContain('s1');
  });

  it('does not offer to start a second one', async () => {
    // Two open shifts would list somebody twice in "who is on now" — the
    // server refuses with a 409, and the UI should not invite the click.
    fetchMyShift.mockResolvedValue(makeShift());

    render(<ShiftControl />);

    await screen.findByText('2:00');
    expect(screen.queryByRole('button', { name: /start shift/i })).not.toBeInTheDocument();
  });

  it('confirms before ending, naming the branch and elapsed time', async () => {
    // Ending is the moment the recorded hours are fixed, so it states what is
    // about to be written rather than just asking "are you sure".
    fetchMyShift.mockResolvedValue(makeShift());
    endShift.mockResolvedValue(makeShift({ endedAt: new Date().toISOString() }));

    render(
      <>
        <ShiftControl />
        <Toaster />
      </>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /end shift/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Marina/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^end shift$/i }));

    await waitFor(() => {
      expect(endShift).toHaveBeenCalledWith('s1');
    });
    expect(await screen.findByRole('button', { name: /start shift/i })).toBeInTheDocument();
  });
});

describe('failure modes', () => {
  it('renders nothing rather than an error when the read fails', async () => {
    // Not knowing whether you are on shift is not worth interrupting whatever
    // you opened the page to do.
    fetchMyShift.mockRejectedValue(new Error('offline'));

    render(<ShiftControl />);

    await waitFor(() => {
      expect(fetchMyShift).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never renders a negative duration', async () => {
    // A clock skew, or a start time an admin corrected into the future, would
    // otherwise show "-1:00".
    fetchMyShift.mockResolvedValue(
      makeShift({ startedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
    );

    render(<ShiftControl />);

    expect(await screen.findByText('0:00')).toBeInTheDocument();
  });
});
