import { apiFetch } from '@/lib/api';
import { STOCK_REASONS, type StockMovementReason } from '@/lib/inventory-api';

/**
 * Client for the bespoke variant routes (`/api/v1/products/:id/variants`,
 * `/api/v1/variants/:id`). Stock follows the exact same append-only
 * movement-log write inventory-api.ts describes — re-exported here
 * (`STOCK_REASONS`) rather than duplicated, since the reason list is one
 * server-side enum either way.
 */

export { STOCK_REASONS, type StockMovementReason };

export interface Variant {
  id: string;
  name: string;
  sku: string | null;
  price: string;
  stock: number;
  productId: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchVariants(productId: string): Promise<Variant[]> {
  const body = await apiFetch<{ variants: Variant[] }>(`/products/${productId}/variants`);
  return body.variants;
}

export interface VariantInput {
  name: string;
  sku?: string;
  price: string;
}

export async function createVariant(productId: string, input: VariantInput): Promise<Variant> {
  const body = await apiFetch<{ variant: Variant }>(`/products/${productId}/variants`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.variant;
}

export async function updateVariant(
  id: string,
  input: Partial<VariantInput>,
): Promise<Variant> {
  const body = await apiFetch<{ variant: Variant }>(`/variants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.variant;
}

export async function deleteVariant(id: string): Promise<void> {
  await apiFetch<undefined>(`/variants/${id}`, { method: 'DELETE' });
}

export interface VariantStockMovement {
  id: string;
  delta: number;
  reason: StockMovementReason;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface AdjustVariantStockInput {
  delta: number;
  reason: StockMovementReason;
  note?: string;
}

export async function adjustVariantStock(
  variantId: string,
  input: AdjustVariantStockInput,
): Promise<{ variant: { id: string; name: string; sku: string | null; stock: number }; movement: VariantStockMovement }> {
  return apiFetch(`/variants/${variantId}/movements`, {
    method: 'POST',
    body: JSON.stringify(input.note ? input : { delta: input.delta, reason: input.reason }),
  });
}

export interface VariantMovementListResult {
  variant: { id: string; name: string; sku: string | null; stock: number };
  movements: (VariantStockMovement & { actorName: string | null })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchVariantMovements(
  variantId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<VariantMovementListResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }

  return apiFetch<VariantMovementListResult>(
    `/variants/${variantId}/movements?${query.toString()}`,
  );
}

export interface VariantReconcileResult {
  variantId: string;
  stock: number;
  fromMovements: number;
  /** False means something wrote `stock` without recording why. */
  agrees: boolean;
}

/**
 * Does the log still agree with the running total? Same purpose as the
 * product-level `fetchReconcile` in inventory-api.ts — built specifically
 * so a discrepancy is diagnosable from the UI rather than by querying the
 * database directly.
 */
export async function fetchVariantReconcile(variantId: string): Promise<VariantReconcileResult> {
  return apiFetch<VariantReconcileResult>(`/variants/${variantId}/reconcile`);
}
