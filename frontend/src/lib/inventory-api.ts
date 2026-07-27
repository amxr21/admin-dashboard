import { apiFetch } from '@/lib/api';

/**
 * Client for the bespoke inventory routes (`/api/v1/inventory`).
 *
 * Stock is a movement log with a transactional write, which the resource
 * engine cannot describe — so this is hand-written rather than going through
 * `resource-api.ts`.
 *
 * ─── THE THRESHOLD IS NOT DECLARED HERE ──────────────────────────────
 * The list response carries `threshold`, and every row carries `isLow`. The UI
 * reads both rather than restating the number, because a second copy drifts:
 * the day someone changes the server's default, a hardcoded 5 here would flag
 * a different set of products than the API considers low, and nothing would
 * fail — the two views would just quietly disagree.
 */

export type StockMovementReason =
  | 'RECEIVED'
  | 'SOLD'
  | 'DAMAGED'
  | 'LOST'
  | 'RETURNED'
  | 'CORRECTION';

/** Every reason the API accepts, in the order the adjust form offers them. */
export const STOCK_REASONS: StockMovementReason[] = [
  'RECEIVED',
  'RETURNED',
  'SOLD',
  'DAMAGED',
  'LOST',
  'CORRECTION',
];

export interface InventoryRow {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  status: string;
  imageUrl: string | null;
  category: { id: string; name: string } | null;
  /** Computed server-side so the UI never re-implements the rule. */
  isLow: boolean;
}

export interface InventoryListResult {
  products: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The threshold the server actually applied. Display this, never a literal. */
  threshold: number;
}

export interface StockMovement {
  id: string;
  delta: number;
  reason: StockMovementReason;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface MovementListResult {
  product: { id: string; name: string; sku: string | null; stock: number };
  movements: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InventoryListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  lowStock?: boolean;
  threshold?: number;
}

export async function fetchInventory(
  params: InventoryListParams = {},
): Promise<InventoryListResult> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // `lowStock: false` must not be sent — the API treats the parameter's
    // presence as the filter, so an explicit false would still narrow.
    if (value === undefined || value === null || value === '' || value === false) {
      continue;
    }
    query.set(key, String(value));
  }

  return apiFetch<InventoryListResult>(`/inventory?${query.toString()}`);
}

export async function fetchMovements(
  productId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<MovementListResult> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }

  return apiFetch<MovementListResult>(
    `/inventory/${productId}/movements?${query.toString()}`,
  );
}

export interface AdjustStockInput {
  /** Signed and non-zero. Negative removes stock. */
  delta: number;
  reason: StockMovementReason;
  note?: string;
}

export async function adjustStock(
  productId: string,
  input: AdjustStockInput,
): Promise<{
  product: { id: string; name: string; sku: string | null; stock: number };
  movement: StockMovement;
}> {
  return apiFetch(`/inventory/${productId}/movements`, {
    method: 'POST',
    body: JSON.stringify(input.note ? input : { delta: input.delta, reason: input.reason }),
  });
}
