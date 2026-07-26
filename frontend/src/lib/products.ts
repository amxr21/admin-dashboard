import { apiFetch } from '@/lib/api';

/**
 * Product catalogue client.
 *
 * ─── PRICE IS A STRING, AND STAYS ONE ────────────────────────────────
 * The API sends `"19.99"`, never `19.99`. Parsing it into a JS number here
 * would undo the whole point: floats can't hold every 2-decimal value, so
 * totals drift once anyone adds them up.
 *
 * Format with `Intl.NumberFormat` for display. Never do arithmetic on the
 * client — the server owns every total.
 */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  /** Decimal string, e.g. "19.99". Not a number, deliberately. */
  price: string;
  imageUrl: string | null;
  status: ProductStatus;
  stock: number;
  categoryId: string | null;
  category: ProductCategory | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResult {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProductStatus;
  categoryId?: string;
}

export async function fetchProducts(
  params: ProductListParams = {},
): Promise<ProductListResult> {
  const query = new URLSearchParams();

  // Empty values are omitted rather than sent blank — the API uses `.strict()`
  // and an empty `status=` would be rejected as an invalid enum value.
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  const body = await apiFetch<{ products: Product[] } & Omit<ProductListResult, 'products'>>(
    `/products?${query.toString()}`,
  );

  return body;
}

export interface DeleteProductResult {
  /** True when the product was archived because it appears in past orders. */
  archived: boolean;
  product: Product;
}

export async function deleteProduct(id: string): Promise<DeleteProductResult> {
  return apiFetch<DeleteProductResult>(`/products/${id}`, { method: 'DELETE' });
}
