import { apiFetch } from '@/lib/api';

/**
 * The till (O5).
 *
 * A scan is EXACT — barcode then SKU, never fuzzy. See `pos.service.ts` for
 * why: a prefix match would let a dropped digit resolve to a real but
 * DIFFERENT product, charging the customer for something they are not
 * holding.
 */

export interface ScannedProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** 2dp string — money never crosses this boundary as a float. */
  price: string;
  /** Stock at the till's branch. Null when no branch is selected, which is a
   *  different fact from a real zero. */
  branchStock: number | null;
  totalStock: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

export async function scanProduct(code: string): Promise<ScannedProduct> {
  const result = await apiFetch<{ product: ScannedProduct }>(
    `/pos/scan?code=${encodeURIComponent(code)}`,
  );
  return result.product;
}

export interface CheckoutLine {
  productId: string;
  quantity: number;
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  /** Cash to hand back. Null on a card sale — nothing was tendered. */
  change: string | null;
}

export async function checkout(input: {
  lines: CheckoutLine[];
  method: string;
  tendered?: string;
  /** Removed (O9.17) — the server resolves the shift from the signed-in user.
   *  A client-supplied one went stale when the cashier clocked out and
   *  credited the previous person's drawer. */
  // shiftId is intentionally absent.
  customerId?: string;
  note?: string;
}): Promise<CheckoutResult> {
  return apiFetch<CheckoutResult>('/pos/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
