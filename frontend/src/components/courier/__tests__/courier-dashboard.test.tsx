import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { CourierDashboard } from '../courier-dashboard';
import type { CourierAssignment } from '@/lib/courier-api';

/**
 * A courier's own job list. The property worth pinning hardest:
 * `COURIER_TRANSITIONS` offers a narrower set of next-statuses than the full
 * `DeliveryStatus` enum (no CANCELED/RETURNED — those stay order-driven, see
 * couriers.service.ts) — a courier must never be offered a button implying
 * they can do something only the order side actually controls.
 */

const fetchMyAssignments = vi.hoisted(() => vi.fn());
const updateAssignmentStatus = vi.hoisted(() => vi.fn());
const readCourier = vi.hoisted(() => vi.fn());
const clearCourierSession = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

vi.mock('@/lib/courier-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/courier-api')>();
  return { ...actual, fetchMyAssignments, updateAssignmentStatus };
});

vi.mock('@/lib/courier-auth-storage', () => ({
  readCourier,
  clearCourierSession,
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/courier',
}));

function makeAssignment(overrides: Partial<CourierAssignment> = {}): CourierAssignment {
  return {
    id: 'a1',
    status: 'ASSIGNED',
    customerName: 'Fatima',
    customerPhone: '+971500000002',
    address: 'Villa 12',
    area: null,
    city: 'Dubai',
    total: '59.98',
    paymentMethod: 'cod',
    note: null,
    attemptCount: 0,
    failureReason: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    order: { id: 'o1', orderNumber: 'ORD-1024' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readCourier.mockReturnValue({ id: 'd1', name: 'Sami' });
});

describe('auth guard', () => {
  it('redirects to courier login when no courier session exists', () => {
    readCourier.mockReturnValue(null);

    render(<CourierDashboard />);

    expect(replace).toHaveBeenCalledWith('/courier/login');
    expect(fetchMyAssignments).not.toHaveBeenCalled();
  });
});

describe('the assignment list', () => {
  it('shows an empty state with no active deliveries', async () => {
    fetchMyAssignments.mockResolvedValue([]);

    render(<CourierDashboard />);

    expect(await screen.findByText(/no deliveries assigned to you/i)).toBeInTheDocument();
  });

  it('renders an assigned delivery with the customer and address', async () => {
    fetchMyAssignments.mockResolvedValue([makeAssignment()]);

    render(<CourierDashboard />);

    expect(await screen.findByText('ORD-1024')).toBeInTheDocument();
    expect(screen.getByText('Fatima')).toBeInTheDocument();
    expect(screen.getByText(/Villa 12, Dubai/)).toBeInTheDocument();
  });

  it('excludes terminal assignments from the active count and list', async () => {
    fetchMyAssignments.mockResolvedValue([
      makeAssignment({ id: 'a1', status: 'ASSIGNED' }),
      makeAssignment({ id: 'a2', status: 'DELIVERED', order: { id: 'o2', orderNumber: 'ORD-2' } }),
    ]);

    render(<CourierDashboard />);

    await screen.findByText('ORD-1024');
    expect(screen.queryByText('ORD-2')).not.toBeInTheDocument();
    expect(screen.getByText(/1 active delivery/i)).toBeInTheDocument();
  });

  it('offers only the courier-scoped next statuses, never CANCELED/RETURNED', async () => {
    fetchMyAssignments.mockResolvedValue([makeAssignment({ status: 'OUT_FOR_DELIVERY' })]);

    render(<CourierDashboard />);

    expect(await screen.findByRole('button', { name: /mark delivered/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark handed over/i })).toBeInTheDocument();
    // A courier can never report a cancellation or return themselves.
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument();
  });

  it('renders no action buttons for a status with no further courier-side move', async () => {
    // DELIVERED is terminal on the courier side too (though it never renders
    // in the active list at all — see the exclusion test above), and
    // HANDED_OVER has no entry in COURIER_TRANSITIONS.
    fetchMyAssignments.mockResolvedValue([makeAssignment({ status: 'ASSIGNED' })]);

    render(<CourierDashboard />);

    expect(await screen.findByRole('button', { name: /mark picked up/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark out for delivery/i })).not.toBeInTheDocument();
  });
});

describe('advancing a status', () => {
  it('sends the chosen status and updates the card in place', async () => {
    fetchMyAssignments.mockResolvedValue([makeAssignment({ status: 'ASSIGNED' })]);
    updateAssignmentStatus.mockResolvedValue(
      makeAssignment({ status: 'PICKED_UP' }),
    );

    render(<CourierDashboard />);

    await userEvent.click(await screen.findByRole('button', { name: /mark picked up/i }));

    await waitFor(() => {
      expect(updateAssignmentStatus).toHaveBeenCalledWith('a1', 'PICKED_UP');
    });
    // The card re-renders with PICKED_UP's own next actions.
    expect(await screen.findByRole('button', { name: /mark out for delivery/i })).toBeInTheDocument();
  });
});

describe('the completed tab (B4.6)', () => {
  it('hides terminal assignments on the Active tab but counts them correctly', async () => {
    fetchMyAssignments.mockResolvedValue([
      makeAssignment({ id: 'a1', status: 'ASSIGNED' }),
      makeAssignment({ id: 'a2', status: 'DELIVERED', order: { id: 'o2', orderNumber: 'ORD-2' } }),
    ]);

    render(<CourierDashboard />);

    await screen.findByText('ORD-1024');
    expect(screen.queryByText('ORD-2')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /active \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /completed \(1\)/i })).toBeInTheDocument();
  });

  it('shows terminal assignments only after switching to the Completed tab', async () => {
    fetchMyAssignments.mockResolvedValue([
      makeAssignment({ id: 'a1', status: 'ASSIGNED' }),
      makeAssignment({ id: 'a2', status: 'DELIVERED', order: { id: 'o2', orderNumber: 'ORD-2' } }),
    ]);

    render(<CourierDashboard />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('radio', { name: /completed/i }));

    expect(await screen.findByText('ORD-2')).toBeInTheDocument();
    expect(screen.queryByText('ORD-1024')).not.toBeInTheDocument();
  });

  it('offers no action buttons for a completed assignment', async () => {
    fetchMyAssignments.mockResolvedValue([
      makeAssignment({ id: 'a1', status: 'DELIVERED' }),
    ]);

    render(<CourierDashboard />);
    await userEvent.click(await screen.findByRole('radio', { name: /completed/i }));

    await screen.findByText('ORD-1024');
    expect(screen.queryByRole('button', { name: /mark/i })).not.toBeInTheDocument();
  });

  it('shows a distinct empty state on the Completed tab when there is no history', async () => {
    fetchMyAssignments.mockResolvedValue([makeAssignment({ id: 'a1', status: 'ASSIGNED' })]);

    render(<CourierDashboard />);
    await screen.findByText('ORD-1024');

    await userEvent.click(screen.getByRole('radio', { name: /completed/i }));

    expect(await screen.findByText(/no completed deliveries yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/no deliveries assigned to you/i)).not.toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('clears the courier session and returns to the login page', async () => {
    fetchMyAssignments.mockResolvedValue([]);

    render(<CourierDashboard />);
    await screen.findByText(/no deliveries assigned to you/i);

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(clearCourierSession).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/courier/login');
  });
});
