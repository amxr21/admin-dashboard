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
