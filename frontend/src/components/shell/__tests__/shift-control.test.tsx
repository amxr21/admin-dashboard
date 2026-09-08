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

const { fetchMyShift, startShift, endShift, closeTill, fetchShiftTakings } = vi.hoisted(() => ({
  fetchMyShift: vi.fn(),
  startShift: vi.fn(),
  endShift: vi.fn(),
  closeTill: vi.fn(),
  fetchShiftTakings: vi.fn(),
}));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchMyShift,
  startShift,
  endShift,
  closeTill,
  fetchShiftTakings,
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
    // No till by default — most shifts have none, and it is the path these
    // existing tests cover.
    openingFloat: null,
    closingCount: null,
    variance: null,
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

describe('the till (O5.11)', () => {
  /**
   * ─── WHY THE FLOAT DECIDES THE SHAPE ─────────────────────────────────
   * A shift opened WITH a drawer must be closed by counting it — ending it
   * without a count leaves a till nobody reconciled, which somebody chases
   * later. A shift opened without one never asks, because most shifts have no
   * till and making a picker count nothing is friction for the majority.
   */
  it('sends the opening float when one is entered', async () => {
    fetchMyShift.mockResolvedValue(null);
    startShift.mockResolvedValue(makeShift({ openingFloat: '100.00' }));

    render(
      <>
        <ShiftControl />
        <Toaster />
      </>,
    );

    await userEvent.type(await screen.findByLabelText(/cash in the drawer/i), '100.00');
    await userEvent.click(screen.getByRole('button', { name: /start shift/i }));

    await waitFor(() => {
      expect(startShift).toHaveBeenCalledWith({ openingFloat: '100.00' });
    });
  });

  it('starts with NO till when the float is left blank', async () => {
    // Null means "no drawer", which is a different fact from a float of zero
    // — and it is what stops the close dialog asking for a count.
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
      expect(startShift).toHaveBeenCalledWith({});
    });
  });

  it('asks for a count when closing a shift that had a drawer', async () => {
    fetchMyShift.mockResolvedValue(makeShift({ openingFloat: '100.00' }));
    fetchShiftTakings.mockResolvedValue({ byMethod: [], cash: '25.00' });

    render(<ShiftControl />);

    await userEvent.click(await screen.findByRole('button', { name: /end shift/i }));

    expect(await screen.findByLabelText(/count the drawer/i)).toBeInTheDocument();
  });

  it('does NOT ask for a count when there was no drawer', async () => {
    fetchMyShift.mockResolvedValue(makeShift());

    render(<ShiftControl />);

    await userEvent.click(await screen.findByRole('button', { name: /end shift/i }));

    await screen.findByRole('alertdialog');
    expect(screen.queryByLabelText(/count the drawer/i)).not.toBeInTheDocument();
  });

  it('closes the till with the count and shows the variance', async () => {
    fetchMyShift.mockResolvedValue(makeShift({ openingFloat: '100.00' }));
    fetchShiftTakings.mockResolvedValue({ byMethod: [], cash: '25.00' });
    closeTill.mockResolvedValue({
      shift: makeShift({ endedAt: new Date().toISOString() }),
      expected: '125.00',
      counted: '123.00',
      variance: '-2.00',
    });

    render(
      <>
        <ShiftControl />
        <Toaster />
      </>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /end shift/i }));
    await userEvent.type(await screen.findByLabelText(/count the drawer/i), '123.00');
    await userEvent.click(screen.getByRole('button', { name: /^end shift$/i }));

    await waitFor(() => {
      expect(closeTill).toHaveBeenCalledWith('s1', '123.00');
    });

    // The variance survives the dialog closing — the cashier sees the result
    // of the count they just made rather than it vanishing with the toast.
    // Scoped to the button, since the toast shows the same figure.
    expect(
      await screen.findByRole('button', { name: /dismiss the till variance/i }),
    ).toHaveTextContent('-2.00');
  });

  it('ends a no-till shift without closing a drawer', async () => {
    fetchMyShift.mockResolvedValue(makeShift());
    endShift.mockResolvedValue(makeShift({ endedAt: new Date().toISOString() }));

    render(
      <>
        <ShiftControl />
        <Toaster />
      </>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /end shift/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^end shift$/i }));

    await waitFor(() => {
      expect(endShift).toHaveBeenCalledWith('s1');
    });
    expect(closeTill).not.toHaveBeenCalled();
  });
});
