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
  /**
   * Acquisition cost per unit, 2dp string. Null means NOT TRACKED (F1.4b).
   *
   * Worth surfacing because profit reporting EXCLUDES uncosted lines
   * entirely — a product nobody has priced is silently missing from margin
   * rather than wrong in it, which is harder to notice.
   */
  cost: string | null;
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
  /**
   * What ONE unit in this batch cost to acquire (F1.4a), as a 2dp string —
   * money crosses the wire as a string so cents cannot be lost to a float.
   *
   * Null means NOT RECORDED, which is different from a recorded "0.00" (free
   * stock — a sample, a warranty replacement — is a real acquisition at a
   * real cost of nothing). Only ever present on an incoming movement.
   */
  unitCost: string | null;
  actorId: string | null;
  /** Resolved server-side, batched. Null when the actor is unknown (a
   *  system-initiated movement) or the account no longer exists — `actorId`
   *  is deliberately not a foreign key, so it survives the staff member
   *  being deleted even though the name can no longer be resolved. */
  actorName: string | null;
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

export interface ReconcileResult {
  productId: string;
  stock: number;
  fromMovements: number;
  /** False means something wrote `stock` without recording why. */
  agrees: boolean;
}

/**
 * Does the log still agree with the running total? Built specifically so
 * discrepancies are diagnosable from the UI (B4.2) — the two are written
 * together and should never diverge, but "should never" is worth checking.
 */
export async function fetchReconcile(productId: string): Promise<ReconcileResult> {
  return apiFetch<ReconcileResult>(`/inventory/${productId}/reconcile`);
}

export interface AdjustStockInput {
  /** Signed and non-zero. Negative removes stock. */
  delta: number;
  reason: StockMovementReason;
  note?: string;
  /**
   * Per-unit acquisition cost for this batch. A string, not a number: the
   * column is `Decimal(10,2)` and a float cannot represent 0.1 exactly.
   *
   * Omit for "not recorded". The server REFUSES it on an outgoing movement
   * (DAMAGED/LOST/SOLD have no acquisition cost) rather than ignoring it,
   * so the UI must not offer the field there.
   */
  unitCost?: string;
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
