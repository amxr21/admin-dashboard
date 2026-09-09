import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { TillEventControls } from '../till-event-controls';

/**
 * No-sale, cash drop, payout (O9 Tier 4).
 *
 * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
 * A NO_SALE must never send an amount (the backend refuses one), and a
 * CASH_DROP/PAYOUT must always send one — the two dialog shapes must not
 * cross.
 */

const { recordTillEvent } = vi.hoisted(() => ({ recordTillEvent: vi.fn() }));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  recordTillEvent,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('till event controls', () => {
  it('logs a no-sale with no amount', async () => {
    recordTillEvent.mockResolvedValue({ id: 'e1', type: 'NO_SALE', amount: null, note: null });

    render(<TillEventControls shiftId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: /^no sale$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /log it/i }));

    await waitFor(() => {
      expect(recordTillEvent).toHaveBeenCalledWith('s1', { type: 'NO_SALE' });
    });
  });

  it('cannot confirm a cash drop with no amount', async () => {
    render(<TillEventControls shiftId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: /cash drop/i }));

    expect(await screen.findByRole('button', { name: /log it/i })).toBeDisabled();
    expect(recordTillEvent).not.toHaveBeenCalled();
  });

  it('logs a payout with an amount and a note', async () => {
    recordTillEvent.mockResolvedValue({
      id: 'e2',
      type: 'PAYOUT',
      amount: '20.00',
      note: 'courier tip',
    });

    render(<TillEventControls shiftId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: /^payout$/i }));

    await userEvent.type(await screen.findByLabelText(/amount/i), '20.00');
    await userEvent.type(screen.getByLabelText(/note/i), 'courier tip');
    await userEvent.click(screen.getByRole('button', { name: /log it/i }));

    await waitFor(() => {
      expect(recordTillEvent).toHaveBeenCalledWith('s1', {
        type: 'PAYOUT',
        amount: '20.00',
        note: 'courier tip',
      });
    });
  });

  it('keeps the dialog open and shows the refusal on a server error', async () => {
    recordTillEvent.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'Enter an amount above zero'));

    render(<TillEventControls shiftId="s1" />);
    await userEvent.click(screen.getByRole('button', { name: /cash drop/i }));
    await userEvent.type(await screen.findByLabelText(/amount/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /log it/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount above zero');
    // Still open — the amount field is still there to correct.
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });
});
