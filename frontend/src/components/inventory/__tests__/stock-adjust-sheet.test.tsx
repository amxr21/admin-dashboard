import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { StockAdjustSheet } from '@/components/inventory/stock-adjust-sheet';
import { render, screen } from '@/test/render';
import type { InventoryRow } from '@/lib/inventory-api';

/**
 * The unit-cost field (F1.4a) is CONDITIONAL, and getting that wrong has a
 * server-side consequence rather than a cosmetic one: the API refuses a cost
 * on an outgoing movement, so offering the field for DAMAGED/LOST would turn
 * a valid adjustment into a 400 the user cannot explain.
 */

const adjustStock = vi.fn();

vi.mock('@/lib/inventory-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inventory-api')>();
  return { ...actual, adjustStock: (...args: unknown[]) => adjustStock(...args) };
});

function product(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: 'p1',
    name: 'Widget',
    sku: 'W-1',
    stock: 10,
    status: 'ACTIVE',
    imageUrl: null,
    category: null,
    cost: null,
    lowStockThreshold: null,
    storageLocation: null,
    isLow: false,
    effectiveThreshold: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  adjustStock.mockResolvedValue({
    product: { id: 'p1', name: 'Widget', sku: 'W-1', stock: 15 },
    movement: { id: 'm1', delta: 5, reason: 'RECEIVED', note: null, unitCost: '4.25', actorId: null, actorName: null, createdAt: '2026-09-06T00:00:00.000Z' },
  });
});

/**
 * F7.1 — the reason DECIDES the direction, it does not merely suggest it.
 *
 * Before this, choosing RECEIVED preselected "in" and then left the toggle
 * clickable, so "received, direction out" was recordable: a movement claiming
 * stock arrived while subtracting it. The log is append-only, so such an entry
 * stands permanently and needs a second compensating movement to undo.
 */
describe('the reason fixes the direction', () => {
  it('locks the toggle once a one-way reason is chosen, and says why', async () => {
    const user = userEvent.setup();
    render(
      <StockAdjustSheet product={product()} open onOpenChange={vi.fn()} onAdjusted={vi.fn()} />,
    );

    await user.click(screen.getByRole('combobox', { name: /reason/i }));
    await user.click(await screen.findByRole('option', { name: /damaged/i }));

    // Both buttons disabled — the direction is a statement now, not a choice.
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^remove$/i })).toBeDisabled();
    // A disabled control with no explanation reads as broken, not decided.
    expect(screen.getByText(/set by the reason/i)).toBeInTheDocument();
  });

  it('leaves the toggle usable for CORRECTION, which genuinely goes both ways', async () => {
    const user = userEvent.setup();
    render(
      <StockAdjustSheet product={product()} open onOpenChange={vi.fn()} onAdjusted={vi.fn()} />,
    );

    await user.click(screen.getByRole('combobox', { name: /reason/i }));
    await user.click(await screen.findByRole('option', { name: /correction/i }));

    expect(screen.getByRole('button', { name: /^add$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^remove$/i })).toBeEnabled();
  });

  it('sends a NEGATIVE delta for an outgoing reason, never a positive one', async () => {
    const user = userEvent.setup();
    render(
      <StockAdjustSheet product={product()} open onOpenChange={vi.fn()} onAdjusted={vi.fn()} />,
    );

    await user.click(screen.getByRole('combobox', { name: /reason/i }));
    await user.click(await screen.findByRole('option', { name: /damaged/i }));
    await user.type(screen.getByLabelText(/amount/i), '3');
    await user.click(screen.getByRole('button', { name: /record/i }));

    // The payload is derived from the IMPLIED direction, so it cannot
    // contradict the reason even if component state drifted.
    expect(adjustStock).toHaveBeenCalledWith('p1', expect.objectContaining({ delta: -3 }));
  });
});

describe('unit cost is offered only where stock arrives', () => {
  it('shows the field once RECEIVED is chosen', async () => {
    const user = userEvent.setup();
    render(
      <StockAdjustSheet product={product()} open onOpenChange={vi.fn()} onAdjusted={vi.fn()} />,
    );

    // Reason starts unset in the adjust variant, so the field starts hidden.
    expect(screen.queryByLabelText(/unit cost/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /reason/i }));
    await user.click(await screen.findByRole('option', { name: /received/i }));

    expect(await screen.findByLabelText(/unit cost/i)).toBeInTheDocument();
  });

  it('hides the field for an outgoing reason, which the server would refuse', async () => {
    const user = userEvent.setup();
    render(
      <StockAdjustSheet product={product()} open onOpenChange={vi.fn()} onAdjusted={vi.fn()} />,
    );

    await user.click(screen.getByRole('combobox', { name: /reason/i }));
    await user.click(await screen.findByRole('option', { name: /damaged/i }));

    expect(screen.queryByLabelText(/unit cost/i)).not.toBeInTheDocument();
  });

  it('is shown up-front in the opening-stock variant, where RECEIVED is preselected', () => {
    render(
      <StockAdjustSheet
        variant="opening"
        product={product({ stock: 0 })}
        open
        onOpenChange={vi.fn()}
        onAdjusted={vi.fn()}
      />,
    );

    // Recording what the first batch cost is exactly the moment someone knows
    // it, so the field should not need hunting for.
    expect(screen.getByLabelText(/unit cost/i)).toBeInTheDocument();
  });

  it('preselects RECEIVED in the receive variant, so the cost field is there immediately', () => {
    // F3.4 — a delivery arriving is the routine case. Asking for the reason
    // from scratch every week is friction on the most repeated action.
    render(
      <StockAdjustSheet
        variant="receive"
        product={product()}
        open
        onOpenChange={vi.fn()}
        onAdjusted={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/unit cost/i)).toBeInTheDocument();
  });

  it('omits unitCost from the payload when left blank — blank means not recorded', async () => {
    const user = userEvent.setup();
    render(
      <StockAdjustSheet
        variant="opening"
        product={product({ stock: 0 })}
        open
        onOpenChange={vi.fn()}
        onAdjusted={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), '5');
    await user.click(screen.getByRole('button', { name: /record/i }));

    // Sending '' or 0 would record "this batch was free", which is a
    // different and false claim.
    expect(adjustStock).toHaveBeenCalledWith(
      'p1',
      expect.not.objectContaining({ unitCost: expect.anything() }),
    );
  });
});
