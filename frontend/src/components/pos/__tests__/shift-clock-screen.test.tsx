import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import type { Shift } from '@/lib/shifts-api';
import { ShiftClockScreen } from '../shift-clock-screen';

/**
 * The X/Z report (O9 Tier 4).
 *
 * ─── WHAT THIS PROTECTS ───────────────────────────────────────────────
 * The Z report has to show the shift AS IT WAS at close, but `useShiftClock`
 * clears `shift` to null the instant `finish()` succeeds (that is what
 * drives the "not on shift" screen) — so the shift id has to be captured
 * BEFORE calling finish(), or there is nothing left to fetch a report for.
 * This is exactly the kind of one-tick timing bug that is invisible from
 * reading the code and only shows up by actually running the close flow.
 */

const {
  fetchMyShift,
  startShift,
  closeTill,
  fetchShiftTakings,
  fetchTillReport,
} = vi.hoisted(() => ({
  fetchMyShift: vi.fn(),
  startShift: vi.fn(),
  closeTill: vi.fn(),
  fetchShiftTakings: vi.fn(),
  fetchTillReport: vi.fn(),
}));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchMyShift,
  startShift,
  closeTill,
  fetchShiftTakings,
  fetchTillReport,
}));

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
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
    approvalStatus: 'PENDING',
    approvedAt: null,
    approvedBy: null,
    approvalNote: null,
    openingFloat: '100.00',
    closingCount: null,
    variance: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the X/Z report', () => {
  it('fetches and shows an X report for the CURRENT open shift', async () => {
    fetchMyShift.mockResolvedValue(makeShift());
    fetchTillReport.mockResolvedValue({
      shift: makeShift(),
      byMethod: [{ method: 'cash', total: '25.00' }],
      cash: '25.00',
      expectedCash: '25.00',
      noSaleCount: 0,
      cashDropTotal: '0.00',
      payoutTotal: '0.00',
      events: [],
      isFinal: false,
    });

    render(<ShiftClockScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /view x report/i }));

    await waitFor(() => {
      expect(fetchTillReport).toHaveBeenCalledWith('s1');
    });
    expect(await screen.findByText(/x report \(mid-shift\)/i)).toBeInTheDocument();
  });

  it('fetches the Z report for the shift that JUST closed, not a stale one', async () => {
    // The core mechanism this test exists to catch: `finish()` clears
    // `shift` to null on success, so the report fetch must use an id
    // captured BEFORE that happens.
    fetchMyShift.mockResolvedValue(makeShift());
    fetchShiftTakings.mockResolvedValue({ byMethod: [], cash: '0.00', expectedCash: '100.00' });
    closeTill.mockResolvedValue({
      shift: makeShift({ endedAt: new Date().toISOString() }),
      expected: '100.00',
      counted: '100.00',
      variance: '0.00',
    });
    fetchTillReport.mockResolvedValue({
      shift: makeShift({ endedAt: new Date().toISOString(), closingCount: '100.00' }),
      byMethod: [],
      cash: '0.00',
      expectedCash: '100.00',
      noSaleCount: 0,
      cashDropTotal: '0.00',
      payoutTotal: '0.00',
      events: [],
      isFinal: true,
    });

    render(<ShiftClockScreen />);
    // First "End shift" opens the confirm AlertDialog.
    await userEvent.click(await screen.findByRole('button', { name: /end shift/i }));
    // Second "End shift" is the AlertDialogAction inside it — this is what
    // actually calls handleFinish(). Scoped to the dialog since the page
    // button behind it matches the same name.
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /end shift/i }));

    await waitFor(() => {
      expect(fetchTillReport).toHaveBeenCalledWith('s1');
    });
    expect(await screen.findByText(/z report/i)).toBeInTheDocument();
  });
});
