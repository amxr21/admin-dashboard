import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { ThermalReceipt, type ReceiptData } from '../thermal-receipt';

/**
 * The till receipt (O5.9).
 *
 * ─── WHAT THIS PROTECTS ──────────────────────────────────────────────
 * The receipt is the customer's document of record, so the figures on it must
 * be the ones the SERVER charged — not the screen's estimate. And a line that
 * does not apply is omitted rather than printed as zero: "Change 0.00" on a
 * card sale reads as a mistake somebody will query.
 */

function makeReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    orderNumber: 'POS-20260908-AB12',
    soldAt: '8 Sep 2026, 14:05',
    lines: [
      { name: 'Flat white', quantity: 2, price: '4.50' },
      { name: 'Croissant', quantity: 1, price: '3.20' },
    ],
    subtotal: '12.20',
    taxAmount: '0.61',
    total: '12.81',
    method: 'cash',
    tendered: '20.00',
    change: '7.19',
    ...overrides,
  };
}

describe('the printed receipt', () => {
  it('shows each line at its extended price, not the unit price', () => {
    // 2 x 4.50 is what the customer paid for that line; printing 4.50 beside
    // a quantity of 2 invites the arithmetic to be checked and fail.
    render(<ThermalReceipt data={makeReceipt()} />);

    expect(screen.getByText('9.00')).toBeInTheDocument();
    expect(screen.getByText('3.20')).toBeInTheDocument();
  });

  it('shows the totals it was given', () => {
    // Straight from the server's response. The screen's estimate never
    // reaches this component.
    render(<ThermalReceipt data={makeReceipt()} />);

    expect(screen.getByText('12.20')).toBeInTheDocument();
    expect(screen.getByText('0.61')).toBeInTheDocument();
    expect(screen.getByText('12.81')).toBeInTheDocument();
  });

  it('omits tendered and change on a card sale', () => {
    // Nothing was handed over and nothing came back. "0.00" would read as a
    // mistake rather than as not-applicable.
    render(<ThermalReceipt data={makeReceipt({ method: 'card', tendered: null, change: null })} />);

    expect(screen.queryByText(/^Cash$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Change$/)).not.toBeInTheDocument();
  });

  it('names the order so a customer can be helped later', () => {
    render(<ThermalReceipt data={makeReceipt()} />);

    expect(screen.getByText('POS-20260908-AB12')).toBeInTheDocument();
  });

  it('renders nothing for a sale with no lines rather than crashing', () => {
    // Defensive: a refund-only or corrected sale could reach here empty, and
    // a blank receipt beats a broken till.
    render(<ThermalReceipt data={makeReceipt({ lines: [] })} />);

    expect(screen.getByText('12.81')).toBeInTheDocument();
  });
});
