import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { Toaster } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { SaleScreen } from '../sale-screen';
import type { ScannedProduct } from '@/lib/pos-api';

/**
 * The till (O5.5).
 *
 * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
 * 1. Scanning the same item twice adds ONE, never a second line. The checkout
 *    endpoint refuses duplicate lines outright, and two lines for one product
 *    would print twice on the receipt.
 * 2. The scan field keeps focus. A hardware scanner is a keyboard — if focus
 *    has wandered, the barcode is typed into whatever is focused instead,
 *    silently changing a quantity to 5012345678900.
 * 3. A refusal from the server is shown VERBATIM. "Only 2 in stock" and
 *    "that is less than the total" are things the cashier must read; a
 *    flattened "something went wrong" leaves them stuck at the counter.
 */

const { scanProduct, checkout, fetchMyShift } = vi.hoisted(() => ({
  scanProduct: vi.fn(),
  checkout: vi.fn(),
  fetchMyShift: vi.fn(),
}));

vi.mock('@/lib/pos-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pos-api')>()),
  scanProduct,
  checkout,
}));

vi.mock('@/lib/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shifts-api')>()),
  fetchMyShift,
}));

function makeProduct(overrides: Partial<ScannedProduct> = {}): ScannedProduct {
  return {
    id: 'p1',
    name: 'Flat white',
    sku: 'FW-1',
    barcode: '5012345678900',
    price: '4.50',
    branchStock: 10,
    totalStock: 40,
    status: 'ACTIVE',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyShift.mockResolvedValue({ id: 'shift-1' });
});

async function scan(code: string) {
  const field = screen.getByLabelText(/scan or type a code/i);
  await userEvent.clear(field);
  await userEvent.type(field, `${code}{Enter}`);
}

describe('building a sale', () => {
  it('adds a scanned product to the cart', async () => {
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');

    expect(await screen.findByText('Flat white')).toBeInTheDocument();
  });

  it('scanning the same item twice adds ONE, not a second line', async () => {
    // The checkout endpoint refuses duplicate lines, and two lines for one
    // product would print twice on the receipt.
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');
    await scan('5012345678900');

    await waitFor(() => {
      expect(screen.getAllByText('Flat white')).toHaveLength(1);
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('returns focus to the scan field after adding', async () => {
    // A hardware scanner is a keyboard. With focus elsewhere the next barcode
    // is typed into whatever is focused — silently setting a quantity to
    // 5012345678900.
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    // Move focus AWAY first. The field carries `autoFocus`, so asserting it
    // straight after render would pass whether or not the component restores
    // focus — the thing this test exists to check.
    await userEvent.click(screen.getByRole('button', { name: /one more flat white/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/scan or type a code/i)).toHaveFocus();
    });
  });

  it('keeps a bad code in the field so it can be corrected', async () => {
    // Retyping a long code from the label is friction; the usual cause is one
    // wrong digit.
    scanProduct.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No product has the code 999'));

    render(<SaleScreen />);
    await scan('999');

    expect(await screen.findByRole('alert')).toHaveTextContent('No product has the code 999');
    expect(screen.getByLabelText(/scan or type a code/i)).toHaveValue('999');
  });

  it('removes a line when its quantity reaches zero', async () => {
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.click(screen.getByRole('button', { name: /one fewer flat white/i }));

    await waitFor(() => {
      expect(screen.queryByText('Flat white')).not.toBeInTheDocument();
    });
  });

  it('warns when the quantity exceeds branch stock, without blocking', async () => {
    // A warning, not a block: the cashier is holding the item, and the SERVER
    // decides whether the sale is allowed (O5.8).
    scanProduct.mockResolvedValue(makeProduct({ branchStock: 1 }));

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.click(screen.getByRole('button', { name: /one more flat white/i }));

    expect(await screen.findByText(/only 1 in stock here/i)).toBeInTheDocument();
    // Still sellable — the button is not disabled by this warning.
    expect(screen.getByRole('button', { name: /take payment/i })).toBeEnabled();
  });
});

describe('taking payment', () => {
  it('sends the cart and the open shift, then clears', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-20260908-ABCD',
      subtotal: '4.50',
      taxAmount: '0.23',
      total: '4.73',
      change: '5.27',
    });

    render(
      <>
        <SaleScreen />
        <Toaster />
      </>,
    );

    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.type(screen.getByLabelText(/cash received/i), '10.00');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [{ productId: 'p1', quantity: 1 }],
          method: 'cash',
          tendered: '10.00',
          // Attached so the drawer can be reconciled at close.
          shiftId: 'shift-1',
        }),
      );
    });

    // Cart cleared, ready for the next customer.
    await waitFor(() => {
      expect(screen.queryByText('Flat white')).not.toBeInTheDocument();
    });
  });

  it('keeps the change on screen after the sale', async () => {
    // The one number still needed AFTER the sale completes. A toast would
    // vanish while the cashier is opening the drawer.
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-20260908-ABCD',
      subtotal: '4.50',
      taxAmount: '0.00',
      total: '4.50',
      change: '5.50',
    });

    render(
      <>
        <SaleScreen />
        <Toaster />
      </>,
    );

    await scan('5012345678900');
    await screen.findByText('Flat white');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    expect(await screen.findByText(/change 5\.50/i)).toBeInTheDocument();
  });

  it('shows a refusal verbatim rather than flattening it', async () => {
    // "Only 2 of Flat white left at this branch" is what the cashier has to
    // read; "something went wrong" leaves them stuck at the counter.
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', 'Only 2 of Flat white left at this branch'),
    );

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only 2 of Flat white left at this branch',
    );
    // The cart survives a refusal — the customer is still standing there.
    expect(screen.getByText('Flat white')).toBeInTheDocument();
  });

  it('cannot take payment on an empty cart', async () => {
    render(<SaleScreen />);

    expect(await screen.findByRole('button', { name: /take payment/i })).toBeDisabled();
  });

  it('sells without a shift when none is open', async () => {
    // An owner ringing up a sale outside any session is real. The payment
    // simply has no shift rather than the sale being refused.
    fetchMyShift.mockResolvedValue(null);
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-1',
      subtotal: '4.50',
      taxAmount: '0.00',
      total: '4.50',
      change: null,
    });

    render(
      <>
        <SaleScreen />
        <Toaster />
      </>,
    );

    await scan('5012345678900');
    await screen.findByText('Flat white');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.not.objectContaining({ shiftId: expect.anything() }),
      );
    });
  });
});
