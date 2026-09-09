import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { ShiftApprovalQueue } from '@/components/staff/shift-approval-queue';
import { render, screen, waitFor } from '@/test/render';
import type { Shift } from '@/lib/shifts-api';

/**
 * A manager's shift-approval queue (O9.19).
 *
 * ─── WHAT THIS PROTECTS ───────────────────────────────────────────────
 * The queue is a RECORD, not a gate — every shift shown here already
 * started and the till already worked, so nothing about this page's own
 * behaviour should ever look like it's blocking someone. The other real
 * risk is rejecting silently: a reason is required, matching the server's
 * own rule, so this covers that the confirm action stays disabled until
 * one is typed.
 */

const { fetchShifts, approveShift, rejectShift } = vi.hoisted(() => ({
  fetchShifts: vi.fn(),
  approveShift: vi.fn(),
  rejectShift: vi.fn(),
}));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchShifts,
  approveShift,
  rejectShift,
}));

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    startedAt: new Date().toISOString(),
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
    openingFloat: null,
    closingCount: null,
    variance: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchShifts.mockResolvedValue({
    shifts: [makeShift()],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
});

describe('the shift approval queue', () => {
  it('only asks for PENDING shifts', async () => {
    render(<ShiftApprovalQueue />);

    await screen.findByText('Sami');

    expect(fetchShifts).toHaveBeenCalledWith(
      expect.objectContaining({ approvalStatus: 'PENDING' }),
    );
  });

  it('approves a shift and refreshes the queue', async () => {
    approveShift.mockResolvedValue(makeShift({ approvalStatus: 'APPROVED' }));

    render(<ShiftApprovalQueue />);
    await screen.findByText('Sami');

    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(approveShift).toHaveBeenCalledWith('s1');
    });
    // Reloaded after the action — the second call proves it, not a guess
    // that the row just silently vanished.
    expect(fetchShifts).toHaveBeenCalledTimes(2);
  });

  it('requires a reason before rejecting can be confirmed', async () => {
    rejectShift.mockResolvedValue(makeShift({ approvalStatus: 'REJECTED' }));

    render(<ShiftApprovalQueue />);
    await screen.findByText('Sami');

    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    await screen.findByLabelText(/reason/i);

    // Two "Reject" buttons exist now (the row action and the dialog's own) —
    // the dialog's is the one still disabled with no reason typed.
    const dialogReject = screen.getAllByRole('button', { name: /^reject$/i }).at(-1)!;
    expect(dialogReject).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/reason/i), 'Times do not match the door log');
    expect(dialogReject).toBeEnabled();

    await userEvent.click(dialogReject);

    await waitFor(() => {
      expect(rejectShift).toHaveBeenCalledWith('s1', 'Times do not match the door log');
    });
  });

  it('shows an empty state when nothing is pending', async () => {
    fetchShifts.mockResolvedValue({ shifts: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });

    render(<ShiftApprovalQueue />);

    expect(await screen.findByText(/nothing waiting on you/i)).toBeInTheDocument();
  });
});
