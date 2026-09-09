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
  /** Resuming a parked cart (O9.12b) — fetch these ids' CURRENT price and
   *  stock rather than what was parked. */
  ids?: string[];
}): Promise<BrowsedProduct[]> {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.categoryId) search.set('categoryId', params.categoryId);
  if (params.ids && params.ids.length > 0) search.set('ids', params.ids.join(','));

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

export interface SplitPayment {
  method: string;
  /** What THIS payment covers — not the sale's total. */
  amount: string;
  tendered?: string;
  reference?: string;
}

export async function checkout(input: {
  lines: CheckoutLine[];
  /** Required UNLESS `splitPayments` is given instead — send one or the
   *  other, never both (the server refuses both together). */
  method?: string;
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
  /** Split payment (O9 Tier 3) — 30 cash, rest on card. At least two
   *  entries, summing to the sale total EXACTLY — the server re-verifies
   *  this against its own computed total, never trusting the client's math. */
  splitPayments?: SplitPayment[];
  /** Exchange (O9.8) — the return this sale is the replacement for. An
   *  otherwise-ordinary sale that also links back to it; the server
   *  validates the return exists, is resolved as REPLACEMENT, and is not
   *  already linked. */
  exchangeReturnId?: string;
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

/**
 * Park / resume a sale (O9.12b) — the customer forgot their wallet, and
 * without this the cashier's only option is to delete the cart and re-scan.
 *
 * `ParkedSaleLine` stores CART SHAPE only, never price — resuming re-fetches
 * both through the ordinary browse/scan path, since a park is meant to last
 * minutes, not lock in a figure a manager would have to explain later.
 */
export interface ParkedSaleLine {
  productId: string;
  quantity: number;
  discountPercent?: number;
}

export interface ParkedSale {
  id: string;
  label: string | null;
  lines: ParkedSaleLine[];
  createdAt: string;
}

export async function parkSale(
  lines: ParkedSaleLine[],
  label?: string,
): Promise<ParkedSale> {
  return apiFetch<ParkedSale>('/pos/parked', {
    method: 'POST',
    body: JSON.stringify(label ? { lines, label } : { lines }),
  });
}

export async function listParkedSales(): Promise<ParkedSale[]> {
  return apiFetch<ParkedSale[]>('/pos/parked');
}

export async function resumeParkedSale(id: string): Promise<ParkedSale> {
  return apiFetch<ParkedSale>(`/pos/parked/${id}/resume`, { method: 'POST' });
}

export async function discardParkedSale(id: string): Promise<void> {
  await apiFetch<void>(`/pos/parked/${id}`, { method: 'DELETE' });
}
