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
