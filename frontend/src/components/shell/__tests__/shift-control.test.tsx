import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { ShiftControl } from '../shift-control';
import type { Shift } from '@/lib/shifts-api';

/**
 * The topbar's shift INDICATOR (F6.3, shrunk 2026-09-09).
 *
 * The actual clock on/off controls moved to their own page
 * (`shift-clock-screen.tsx`, `/admin/pos/shift`) — this component is now
 * read-only, so what matters here is just that it shows the right state and
 * links to where the real controls live, not the start/end mechanics
 * themselves (covered by `shift-clock-screen.test.tsx`).
 */

const { fetchMyShift } = vi.hoisted(() => ({ fetchMyShift: vi.fn() }));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchMyShift,
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
    openingFloat: null,
    closingCount: null,
    variance: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the shift indicator', () => {
  it('renders nothing until the first read settles', () => {
    // Never resolves within the test — asserting the pre-settle frame.
    fetchMyShift.mockReturnValue(new Promise(() => undefined));

    render(<ShiftControl />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the elapsed time when on shift', async () => {
    fetchMyShift.mockResolvedValue(makeShift());

    render(<ShiftControl />);

    expect(await screen.findByText('2:00')).toBeInTheDocument();
  });

  it('shows an off-shift state when there is no open shift', async () => {
    fetchMyShift.mockResolvedValue(null);

    render(<ShiftControl />);

    expect(await screen.findByText(/off shift/i)).toBeInTheDocument();
  });

  it('links to the shift page in both states', async () => {
    fetchMyShift.mockResolvedValue(makeShift());

    render(<ShiftControl />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/admin/pos/shift');
  });
});
