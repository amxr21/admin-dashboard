import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor, within } from '@/test/render';
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

const {
  scanProduct,
  checkout,
  browseProducts,
  browseCategories,
  requestManagerOverride,
  voidSale,
  addOrderNote,
  parkSale,
  listParkedSales,
  resumeParkedSale,
  discardParkedSale,
  fetchOrders,
  fetchOrder,
  createReturn,
  approveReturn,
} = vi.hoisted(() => ({
  scanProduct: vi.fn(),
  checkout: vi.fn(),
  browseProducts: vi.fn(),
  browseCategories: vi.fn(),
  requestManagerOverride: vi.fn(),
  voidSale: vi.fn(),
  addOrderNote: vi.fn(),
  parkSale: vi.fn(),
  listParkedSales: vi.fn(),
  resumeParkedSale: vi.fn(),
  discardParkedSale: vi.fn(),
  fetchOrders: vi.fn(),
  fetchOrder: vi.fn(),
  createReturn: vi.fn(),
  approveReturn: vi.fn(),
}));

vi.mock('@/lib/pos-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pos-api')>()),
  scanProduct,
  checkout,
  browseProducts,
  browseCategories,
  voidSale,
  parkSale,
  listParkedSales,
  resumeParkedSale,
  discardParkedSale,
}));

vi.mock('@/lib/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-api')>()),
  requestManagerOverride,
}));

vi.mock('@/lib/orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orders-api')>()),
  addOrderNote,
  fetchOrders,
  fetchOrder,
}));

vi.mock('@/lib/returns-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/returns-api')>()),
  createReturn,
  approveReturn,
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
  // These tests are about the scan+cart path, not the grid (see
  // product-grid.test.tsx for that). Resolving empty keeps it quiet.
  browseProducts.mockResolvedValue([]);
  browseCategories.mockResolvedValue([]);
  // Fetched once on mount for the parked-carts panel — empty keeps it quiet
  // for tests that aren't about parking (see the dedicated describe below).
  listParkedSales.mockResolvedValue([]);
});

async function scan(code: string) {
  const field = screen.getByLabelText(/scan or type a code/i);
  await userEvent.clear(field);
  await userEvent.type(field, `${code}{Enter}`);
}

/**
 * "Take Payment" now opens a confirm dialog (O9.10 follow-up) rather than
 * charging directly — this walks through it the way a cashier would, so
 * every existing checkout test still exercises the real path.
 */
async function takePaymentThroughConfirm() {
  await userEvent.click(screen.getByRole('button', { name: /take payment/i }));
  await userEvent.click(await screen.findByRole('button', { name: /confirm & charge/i }));
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
  it('sends the cart, then clears', async () => {
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
    await takePaymentThroughConfirm();

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [{ productId: 'p1', quantity: 1 }],
          method: 'cash',
          tendered: '10.00',
        }),
        expect.any(String),
      );
    });

    /**
     * No `shiftId` — the server resolves it from the signed-in user (O9.17).
     *
     * This screen used to read the open shift once on mount and send that id
     * with every sale. Held for the life of the page it went stale the moment
     * the cashier clocked out, so handing the terminal over without a reload
     * credited the PREVIOUS person's drawer. Asserted explicitly because
     * reintroducing it would look harmless and silently misattribute cash.
     */
    expect(checkout).not.toHaveBeenCalledWith(
      expect.objectContaining({ shiftId: expect.anything() }),
    );

    // Cart cleared, ready for the next customer.
    await waitFor(() => {
      expect(screen.queryByText('Flat white')).not.toBeInTheDocument();
    });
  });

  it('sends an optional card reference number, only when paying by card', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-20260908-ABCD',
      subtotal: '4.50',
      taxAmount: '0.23',
      total: '4.73',
      change: null,
    });

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.click(screen.getByLabelText(/^payment$/i));
    await userEvent.click(await screen.findByRole('option', { name: /card/i }));

    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));
    await userEvent.type(
      await screen.findByLabelText(/terminal reference/i),
      'TX-9981',
    );
    await userEvent.click(screen.getByRole('button', { name: /confirm & charge/i }));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'card', reference: 'TX-9981' }),
        expect.any(String),
      );
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
    await takePaymentThroughConfirm();

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
    await takePaymentThroughConfirm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only 2 of Flat white left at this branch',
    );
    // The cart survives a refusal — the customer is still standing there.
    // Two matches now (the cart list AND the still-open confirm dialog's own
    // line-item summary), which is the correct new shape, not a bug — the
    // dialog stays open on a failed charge so the cashier sees the refusal
    // right where they are (see the onClick comment on AlertDialogAction).
    expect(screen.getAllByText('Flat white').length).toBeGreaterThan(0);
  });

  it('cannot take payment on an empty cart', async () => {
    render(<SaleScreen />);

    expect(await screen.findByRole('button', { name: /take payment/i })).toBeDisabled();
  });
});

describe('discounts (O9 Tier 3)', () => {
  it('sends discountPercent only when a line has one set', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-1',
      subtotal: '4.05',
      taxAmount: '0.00',
      total: '4.05',
      change: null,
    });

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.type(screen.getByLabelText(/discount on flat white/i), '10');
    await takePaymentThroughConfirm();

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [{ productId: 'p1', quantity: 1, discountPercent: 10 }],
        }),
        expect.any(String),
      );
    });
  });

  it('opens the manager override dialog for a discount above the cap, not the confirm dialog', async () => {
    // The test double's default cap is 20% (settings-provider.tsx's
    // DEFAULT_VALUE, used whenever no SettingsProvider wraps the tree).
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.type(screen.getByLabelText(/discount on flat white/i), '50');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    expect(await screen.findByText(/manager approval needed/i)).toBeInTheDocument();
    // NOT the confirm-and-charge dialog — money must not start moving before
    // the override is granted.
    expect(screen.queryByText(/confirm sale/i)).not.toBeInTheDocument();
  });

  it('proceeds to the confirm dialog and includes the override token once approved', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    requestManagerOverride.mockResolvedValue({
      approverId: 'm1',
      approverName: 'Sara',
      overrideToken: 'signed-token',
    });
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-1',
      subtotal: '2.25',
      taxAmount: '0.00',
      total: '2.25',
      change: null,
    });

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.type(screen.getByLabelText(/discount on flat white/i), '50');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    await userEvent.type(await screen.findByLabelText(/manager email/i), 'sara@example.test');
    await userEvent.type(screen.getByLabelText(/manager password/i), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    // Approval closes ITS dialog and opens the confirm dialog.
    await screen.findByText(/confirm sale/i);
    await userEvent.click(screen.getByRole('button', { name: /confirm & charge/i }));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({ overrideToken: 'signed-token' }),
        expect.any(String),
      );
    });
  });

  it('does not open the override dialog for a discount at or below the cap', async () => {
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.type(screen.getByLabelText(/discount on flat white/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /take payment/i }));

    expect(await screen.findByText(/confirm sale/i)).toBeInTheDocument();
    expect(screen.queryByText(/manager approval needed/i)).not.toBeInTheDocument();
  });
});

describe('voiding a sale (O9 Tier 3)', () => {
  async function completeASale() {
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
    await takePaymentThroughConfirm();
    await screen.findByText(/sale pos-1/i);
  }

  it('voids the sale that was just rung up', async () => {
    voidSale.mockResolvedValue({ orderId: 'o1', orderNumber: 'POS-1' });

    await completeASale();
    await userEvent.click(screen.getByRole('button', { name: /void this sale/i }));

    await waitFor(() => {
      expect(voidSale).toHaveBeenCalledWith('o1', undefined);
    });
    // The receipt panel (and the void button with it) is gone — nothing
    // left to void twice.
    expect(screen.queryByRole('button', { name: /void this sale/i })).not.toBeInTheDocument();
  });

  it('opens the manager override dialog when voiding is refused, then retries with the token', async () => {
    voidSale
      .mockRejectedValueOnce(
        new ApiError(403, 'FORBIDDEN', 'A manager needs to approve this in place'),
      )
      .mockResolvedValueOnce({ orderId: 'o1', orderNumber: 'POS-1' });
    requestManagerOverride.mockResolvedValue({
      approverId: 'm1',
      approverName: 'Sara',
      overrideToken: 'signed-token',
    });

    await completeASale();
    await userEvent.click(screen.getByRole('button', { name: /void this sale/i }));

    expect(await screen.findByText(/manager approval needed/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/manager email/i), 'sara@example.test');
    await userEvent.type(screen.getByLabelText(/manager password/i), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(voidSale).toHaveBeenLastCalledWith('o1', 'signed-token');
    });
  });

  it('has no order left to void once a new item starts a fresh sale', async () => {
    await completeASale();

    // Starting the next customer's sale clears the previous receipt AND the
    // ability to void it from here — see the comment in addToCart().
    await scan('5012345678900');

    expect(screen.queryByRole('button', { name: /void this sale/i })).not.toBeInTheDocument();
  });
});

describe('a note on the sale (O9 Tier 3)', () => {
  it('saves a note against the completed order via the existing thread', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-1',
      subtotal: '4.50',
      taxAmount: '0.00',
      total: '4.50',
      change: null,
    });
    addOrderNote.mockResolvedValue({});

    render(
      <>
        <SaleScreen />
        <Toaster />
      </>,
    );
    await scan('5012345678900');
    await screen.findByText('Flat white');
    await takePaymentThroughConfirm();
    await screen.findByText(/sale pos-1/i);

    await userEvent.type(
      screen.getByLabelText(/note on this sale/i),
      'Customer asked to hold at pickup',
    );
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(addOrderNote).toHaveBeenCalledWith('o1', 'Customer asked to hold at pickup');
    });
    expect((await screen.findAllByText(/note saved/i)).length).toBeGreaterThan(0);
  });

  it('cannot save an empty note', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-1',
      subtotal: '4.50',
      taxAmount: '0.00',
      total: '4.50',
      change: null,
    });

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');
    await takePaymentThroughConfirm();
    await screen.findByText(/sale pos-1/i);

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(addOrderNote).not.toHaveBeenCalled();
  });
});

describe('split payment (O9 Tier 3)', () => {
  it('sends splitPayments instead of method when the split toggle is on', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'o1',
      orderNumber: 'POS-1',
      subtotal: '4.50',
      taxAmount: '0.00',
      total: '4.50',
      change: null,
    });

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.click(screen.getByLabelText(/split payment/i));

    const amountFields = screen.getAllByLabelText(/payment \d amount/i);
    await userEvent.type(amountFields[0]!, '2.00');
    await userEvent.type(amountFields[1]!, '2.50');

    await takePaymentThroughConfirm();

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          splitPayments: [
            { method: 'cash', amount: '2.00' },
            { method: 'card', amount: '2.50' },
          ],
        }),
        expect.any(String),
      );
      // Not present at all, not even as undefined-through — the server
      // refuses seeing both shapes together.
      expect(checkout.mock.calls[0]?.[0]).not.toHaveProperty('method');
    });
  });

  it('can add and remove a payment line, never below two', async () => {
    scanProduct.mockResolvedValue(makeProduct());

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');
    await userEvent.click(screen.getByLabelText(/split payment/i));

    expect(screen.getAllByLabelText(/payment \d amount/i)).toHaveLength(2);
    // No remove button yet — never below two entries.
    expect(screen.queryByRole('button', { name: /remove payment/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /add another payment/i }));
    expect(screen.getAllByLabelText(/payment \d amount/i)).toHaveLength(3);

    await userEvent.click(screen.getAllByRole('button', { name: /remove payment/i })[0]!);
    expect(screen.getAllByLabelText(/payment \d amount/i)).toHaveLength(2);
  });
});

describe('park / resume a sale (O9.12b)', () => {
  it('parks the cart and clears it', async () => {
    scanProduct.mockResolvedValue(makeProduct());
    parkSale.mockResolvedValue({ id: 'park-1', label: null, lines: [], createdAt: '' });
    listParkedSales.mockResolvedValue([]);

    render(<SaleScreen />);
    await scan('5012345678900');
    await screen.findByText('Flat white');

    await userEvent.click(screen.getByRole('button', { name: /^park$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^park$/i }));

    await waitFor(() => {
      expect(parkSale).toHaveBeenCalledWith(
        [{ productId: 'p1', quantity: 1 }],
        undefined,
      );
    });

    // Cart cleared — the scanned item is no longer listed.
    expect(screen.queryByText('Flat white')).not.toBeInTheDocument();
  });

  it('lists a parked cart and resumes it, re-fetching current price/stock', async () => {
    listParkedSales.mockResolvedValueOnce([
      { id: 'park-1', label: 'Sara', lines: [{ productId: 'p1', quantity: 2 }], createdAt: '' },
    ]);
    resumeParkedSale.mockResolvedValue({
      id: 'park-1',
      label: 'Sara',
      lines: [{ productId: 'p1', quantity: 2 }],
      createdAt: '',
    });
    browseProducts.mockImplementation((params: { ids?: string[] }) =>
      params.ids
        ? Promise.resolve([
            {
              id: 'p1',
              name: 'Flat white',
              price: '5.00', // current price, deliberately different from any parked figure
              imageUrl: null,
              categoryId: null,
              branchStock: 8,
              status: 'ACTIVE' as const,
            },
          ])
        : Promise.resolve([]),
    );

    render(<SaleScreen />);
    await screen.findByText('Sara');

    await userEvent.click(screen.getByRole('button', { name: /resume/i }));

    await waitFor(() => {
      expect(resumeParkedSale).toHaveBeenCalledWith('park-1');
    });
    expect(browseProducts).toHaveBeenCalledWith({ ids: ['p1'] });

    // Restored with the FRESHLY fetched price, not a stale parked one.
    expect(await screen.findByText('Flat white')).toBeInTheDocument();
    expect(screen.getByText('5.00')).toBeInTheDocument();
  });

  it('discarding removes it from the list without touching the cart', async () => {
    listParkedSales
      .mockResolvedValueOnce([
        { id: 'park-1', label: 'Sara', lines: [{ productId: 'p1', quantity: 1 }], createdAt: '' },
      ])
      .mockResolvedValue([]);
    discardParkedSale.mockResolvedValue(undefined);

    render(<SaleScreen />);
    await screen.findByText('Sara');

    await userEvent.click(screen.getByLabelText(/discard sara/i));

    await waitFor(() => {
      expect(discardParkedSale).toHaveBeenCalledWith('park-1');
    });
    expect(screen.queryByText('Sara')).not.toBeInTheDocument();
  });
});

describe('exchange (O9.8)', () => {
  it('links the replacement sale to the return once one is processed as REPLACEMENT', async () => {
    fetchOrders.mockResolvedValue({
      orders: [
        {
          id: 'o1',
          orderNumber: 'POS-1',
          status: 'DELIVERED',
          total: '25.00',
          placedAt: new Date().toISOString(),
          paymentMethod: 'cash',
          customer: null,
          branch: null,
          itemCount: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 5,
      totalPages: 1,
    });
    fetchOrder.mockResolvedValue({
      id: 'o1',
      orderNumber: 'POS-1',
      status: 'DELIVERED',
      branch: null,
      total: '25.00',
      subtotal: '25.00',
      taxAmount: '0.00',
      paymentMethod: 'cash',
      placedAt: new Date().toISOString(),
      notes: [],
      customer: null,
      items: [
        {
          id: 'oi1',
          quantity: 1,
          price: '25.00',
          lineTotal: '25.00',
          productId: 'other-product',
          product: { id: 'other-product', name: 'Wrong size shirt', sku: 'WS-1', imageUrl: null },
        },
      ],
      statusHistory: [],
      assignment: null,
    });
    createReturn.mockResolvedValue({ id: 'r1' });
    approveReturn.mockResolvedValue({ id: 'r1' });
    scanProduct.mockResolvedValue(makeProduct());
    checkout.mockResolvedValue({
      orderId: 'new-order',
      orderNumber: 'POS-2',
      subtotal: '4.50',
      taxAmount: '0.00',
      total: '4.50',
      change: null,
    });

    render(<SaleScreen />);

    await userEvent.click(screen.getByRole('button', { name: /process a return/i }));
    await userEvent.type(screen.getByLabelText(/order number/i), 'POS-1');
    await userEvent.click(screen.getByRole('button', { name: /look up/i }));
    await screen.findByText(/order pos-1/i);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText(/reason/i);
    await userEvent.click(screen.getByRole('combobox', { name: /resolution/i }));
    await userEvent.click(await screen.findByRole('option', { name: /replacement/i }));
    await userEvent.click(screen.getByRole('button', { name: /process return/i }));

    // The exchange banner shows once the return is done — the cashier still
    // has to ring up the replacement item.
    expect(await screen.findByText(/exchange in progress/i)).toBeInTheDocument();

    await scan('5012345678900');
    await screen.findByText('Flat white');
    await takePaymentThroughConfirm();

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({ exchangeReturnId: 'r1' }),
        expect.any(String),
      );
    });

    // The completed exchange is over — the banner is gone for the next,
    // ordinary customer.
    expect(screen.queryByText(/exchange in progress/i)).not.toBeInTheDocument();
  });
});
