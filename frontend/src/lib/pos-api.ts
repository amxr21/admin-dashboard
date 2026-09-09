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

/**
 * The grid a cashier taps instead of scanning (O9.10).
 *
 * The owner confirmed the shop will not be barcoding its stock, so this is
 * the PRIMARY way a cashier finds most of the catalogue — counted against
 * the live database when this was built: 30 products, 1 barcode. Scanning
 * stays exactly as exact as it was for the few that do carry a code.
 */
export interface BrowsedProduct {
  id: string;
  name: string;
  /** 2dp string, same rule as everywhere else money crosses this boundary. */
  price: string;
  imageUrl: string | null;
  categoryId: string | null;
  /** Same meaning as `ScannedProduct.branchStock`. */
  branchStock: number | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

export async function browseProducts(params: {
  q?: string;
  categoryId?: string;
}): Promise<BrowsedProduct[]> {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.categoryId) search.set('categoryId', params.categoryId);

  const qs = search.toString();
  const result = await apiFetch<{ products: BrowsedProduct[] }>(
    `/pos/browse${qs ? `?${qs}` : ''}`,
  );
  return result.products;
}

export interface BrowseCategory {
  id: string;
  name: string;
}

export async function browseCategories(): Promise<BrowseCategory[]> {
  const result = await apiFetch<{ categories: BrowseCategory[] }>('/pos/browse/categories');
  return result.categories;
}

export interface CheckoutLine {
  productId: string;
  quantity: number;
  /** A cashier's ad-hoc discount on THIS line (O9 Tier 3), 0-100. Was
   *  missing from this interface entirely — `sale-screen.tsx` sent it via an
   *  inferred array literal, which TypeScript never checked against this
   *  type, so the mismatch compiled clean while genuinely being out of
   *  sync. Found while adding the void feature and reading this file fresh. */
  discountPercent?: number;
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
  /** The card terminal's own receipt/reference number — optional, cash never
   *  has one. See the schema comment on `Payment.reference`. */
  reference?: string;
  /** Proof a manager approved a discount above the cap (O9.13) — verified
   *  server-side against the signature, never trusted as a bare claim.
   *  Was also missing from this type — see the note on `CheckoutLine`. */
  overrideToken?: string;
}): Promise<CheckoutResult> {
  return apiFetch<CheckoutResult>('/pos/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Void a just-completed sale (O9 Tier 3) — distinct from a return: same
 * sale, undone at the same register moments later, not a customer bringing
 * something back days on. Requires `overrideToken` when the caller is a
 * cashier — see the backend's own doc comment on `voidSale`.
 */
export interface VoidSaleResult {
  orderId: string;
  orderNumber: string;
}

export async function voidSale(
  orderId: string,
  overrideToken?: string,
): Promise<VoidSaleResult> {
  return apiFetch<VoidSaleResult>(`/pos/orders/${orderId}/void`, {
    method: 'POST',
    body: JSON.stringify(overrideToken ? { overrideToken } : {}),
  });
}
