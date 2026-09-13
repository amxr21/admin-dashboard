import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShiftsTable } from '@/components/staff/shifts-table';
import { render, screen, waitFor } from '@/test/render';
import type { Shift } from '@/lib/shifts-api';

/**
 * The shifts table (Task 2).
 *
 * ─── WHAT THIS PROTECTS ───────────────────────────────────────────────
 * The "Working now" view gained a Sales count and a Taken column so the
 * roster reads as a live floor view, not just presence. Without a test the
 * whole ShiftsTable had NO coverage, so those two columns could have been
 * deleted with every suite still green. These pin that each renders its
 * value.
 */

const { fetchShifts } = vi.hoisted(() => ({ fetchShifts: vi.fn() }));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchShifts,
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
    salesCount: 7,
    taken: '182.50',
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

describe('shifts table', () => {
  it('shows the sales count and money taken for each shift', async () => {
    render(<ShiftsTable openOnly />);

    // The person renders once the row is in.
    expect(await screen.findByText('Sami')).toBeInTheDocument();
    // The two Task-2 columns carry their values.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('182.50')).toBeInTheDocument();
  });

  it('renders a zeroed shift without inventing a total', async () => {
    fetchShifts.mockResolvedValue({
      shifts: [makeShift({ salesCount: 0, taken: '0.00' })],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    render(<ShiftsTable openOnly />);

    await waitFor(() => expect(fetchShifts).toHaveBeenCalled());
    expect(await screen.findByText('0.00')).toBeInTheDocument();
  });
});
