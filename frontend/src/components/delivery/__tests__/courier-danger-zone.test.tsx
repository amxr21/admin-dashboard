import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CourierDangerZone } from '../courier-danger-zone';
import type { CourierDetail } from '@/lib/delivery-api';

/**
 * C5.2 — the courier detail page's danger zone: deactivate.
 *
 * What's worth pinning:
 *   - the confirm button stays disabled until the exact phrase is typed —
 *     same discipline as the settings danger zone (B3.4) this reuses the
 *     shared `DangerZoneRow`/`useTypedConfirm` building blocks from
 *   - an active-assignment count changes the confirmation copy (states the
 *     dependency) rather than staying silent about it
 *   - already-inactive couriers get a plain notice, not a dead "Deactivate"
 *     button that would just 400
 */

const updateCourier = vi.hoisted(() => vi.fn());
vi.mock('@/lib/delivery-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/delivery-api')>();
  return { ...actual, updateCourier };
});

function makeCourier(overrides: Partial<CourierDetail> = {}): CourierDetail {
  return {
    id: 'c1',
    name: 'Sami',
    email: null,
    phone: null,
    vehicleType: null,
    plateNumber: null,
    zone: null,
    region: null,
    country: null,
    status: 'ACTIVE',
    createdAt: '2026-07-01T00:00:00.000Z',
    hasAccessCode: true,
    activeAssignments: 0,
    assignments: [],
    ...overrides,
  };
}

beforeEach(() => {
  updateCourier.mockReset();
});

describe('deactivate', () => {
  it('keeps the confirm button disabled until the exact phrase is typed', async () => {
    render(<CourierDangerZone courier={makeCourier()} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Deactivate' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/type deactivate/i), 'wrong');
    expect(confirmButton).toBeDisabled();

    await userEvent.clear(within(dialog).getByLabelText(/type deactivate/i));
    await userEvent.type(within(dialog).getByLabelText(/type deactivate/i), 'DEACTIVATE');
    expect(confirmButton).toBeEnabled();
  });

  it('states the active-assignment count rather than staying silent about it', async () => {
    render(
      <CourierDangerZone courier={makeCourier({ activeAssignments: 3 })} onChanged={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByText(/3 active deliveries/i)).toBeInTheDocument();
  });

  it('says nothing about active deliveries when there are none', async () => {
    render(
      <CourierDangerZone courier={makeCourier({ activeAssignments: 0 })} onChanged={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(screen.queryByText(/active deliver/i)).not.toBeInTheDocument();
  });

  it('deactivates and reports the courier as changed once confirmed', async () => {
    const onChanged = vi.fn();
    updateCourier.mockResolvedValue({ ...makeCourier(), status: 'INACTIVE' });

    render(<CourierDangerZone courier={makeCourier()} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/type deactivate/i), 'DEACTIVATE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(updateCourier).toHaveBeenCalledWith('c1', { status: 'INACTIVE' });
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', status: 'INACTIVE' }),
      );
    });
  });

  it('surfaces a failed deactivation instead of failing silently', async () => {
    updateCourier.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CourierDangerZone courier={makeCourier()} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/type deactivate/i), 'DEACTIVATE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(updateCourier).toHaveBeenCalled();
    });
  });

  it('shows a plain notice instead of a dead button for an already-inactive courier', () => {
    render(<CourierDangerZone courier={makeCourier({ status: 'INACTIVE' })} onChanged={vi.fn()} />);

    expect(screen.getByText(/already deactivated/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });
});
