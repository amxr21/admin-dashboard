import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { DeliveryBoard } from '@/components/delivery/delivery-board';
import { render, screen, waitFor } from '@/test/render';
import type { DeliveryBoardAssignment } from '@/lib/delivery-api';

const { fetchDeliveryBoard, fetchCouriers, fetchDeliveryTimeline } = vi.hoisted(() => ({
  fetchDeliveryBoard: vi.fn(),
  fetchCouriers: vi.fn(),
  fetchDeliveryTimeline: vi.fn(),
}));

vi.mock('@/lib/delivery-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/delivery-api')>()),
  fetchDeliveryBoard,
  fetchCouriers,
  fetchDeliveryTimeline,
}));

const assignment: DeliveryBoardAssignment = {
  id: 'a1',
  status: 'OUT_FOR_DELIVERY',
  customerName: 'ليلى سالم',
  customerPhone: '+971500000000',
  address: 'Marina Walk',
  city: 'Dubai',
  total: '45.00',
  paymentMethod: 'CARD',
  note: null,
  attemptCount: 0,
  failureReason: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T09:00:00.000Z',
  driver: { id: 'c1', name: 'Sami', phone: null, status: 'ON_SHIFT' },
  order: {
    id: 'o1',
    orderNumber: 'ORD-1001',
    status: 'SHIPPED',
    branchId: 'b1',
    branch: { id: 'b1', name: 'Marina', code: 'MAR' },
    placedAt: '2026-09-10T07:30:00.000Z',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchCouriers.mockResolvedValue({ couriers: [], total: 0, page: 1, pageSize: 100, totalPages: 1 });
  fetchDeliveryBoard.mockResolvedValue({
    assignments: [assignment],
    counts: {
      ASSIGNED: 0, PICKED_UP: 0, OUT_FOR_DELIVERY: 1, DELIVERED: 0,
      HANDED_OVER: 0, CANCELED: 0, RETURNED: 0, FAILED_ATTEMPT: 0,
    },
    total: 1, page: 1, pageSize: 20, totalPages: 1,
  });
  fetchDeliveryTimeline.mockResolvedValue({
    assignment: { id: 'a1', order: { id: 'o1', orderNumber: 'ORD-1001' }, driver: { id: 'c1', name: 'Sami' } },
    events: [{ id: 'e1', action: 'delivery.assignment.assigned', actorName: 'Admin', createdAt: '2026-09-10T08:00:00.000Z', detail: {} }],
  });
});

describe('delivery board', () => {
  it('loads the active queue and renders operational assignment context', async () => {
    render(<DeliveryBoard />);

    expect(await screen.findByText('ORD-1001')).toBeInTheDocument();
    expect(screen.getByText('ليلى سالم')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Sami')).toBeInTheDocument();
    expect(fetchDeliveryBoard).toHaveBeenCalledWith(expect.objectContaining({ queue: 'active' }));
  });

  it('opens an accessible assignment timeline', async () => {
    render(<DeliveryBoard />);
    await screen.findByText('ORD-1001');
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));

    expect(await screen.findByText('Courier assigned')).toBeInTheDocument();
    await waitFor(() => expect(fetchDeliveryTimeline).toHaveBeenCalledWith('a1'));
  });

  it('uses localized Arabic controls in RTL', async () => {
    render(<DeliveryBoard />, { locale: 'ar' });
    expect(await screen.findByRole('radiogroup', { name: 'قائمة التوصيل' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
