import type { ProductStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

/**
 * The till's own reads (O5).
 *
 * ─── WHY A SCAN IS NOT THE SEARCH ENDPOINT ───────────────────────────
 * `/search` and the product list both answer "show me things that might
 * match". A scan is the opposite question: this exact code is in my hand, give
 * me the one product it belongs to, or tell me plainly that nothing has it.
 * Routing a scan through fuzzy search means a mistyped digit silently adds a
 * DIFFERENT product to the basket, which is the worst outcome at a till — the
 * customer is charged for something they are not holding.
 *
 * So: exact match only, on `barcode` (globally unique) then `sku`.
 */

export interface ScannedProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Unit price as a 2dp string — money never crosses this boundary as a
   *  float, the same rule as everywhere else in this codebase. */
  price: string;
  /** Stock AT THE BRANCH the till is standing in, not the all-branch total.
   *  Null when no branch is in context, which the caller must distinguish
   *  from a real zero. */
  branchStock: number | null;
  /** The all-branch figure, so a cashier can say "we have none here, the
   *  warehouse has twelve" rather than just "no". */
  totalStock: number;
  /**
   * DRAFT / ACTIVE / ARCHIVED. Returned rather than filtered on, so the till
   * decides what to do: a DRAFT product physically on the shelf still has to
   * be sellable, and hiding it would leave a cashier holding an item the
   * system claims not to know.
   */
  status: ProductStatus;
}

/**
 * Find the one product carrying this code.
 *
 * `barcode` first because it is what a scanner emits and it is globally
 * unique; `sku` second for a shop whose own codes are printed on the shelf
 * label. Both are exact — see the note above.
 */
export async function scanProduct(
  code: string,
  branchId: string | null,
): Promise<ScannedProduct> {
  const trimmed = code.trim();

  if (trimmed === '') {
    throw AppError.badRequest('Scan or type a code', { field: 'code' });
  }

  const product = await prisma.product.findFirst({
    where: { OR: [{ barcode: trimmed }, { sku: trimmed }] },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      price: true,
      stock: true,
      status: true,
    },
  });

  if (!product) {
    // The code is echoed back deliberately: at a till the usual cause is a
    // mis-scan, and seeing what was actually read is how somebody notices a
    // digit was dropped.
    throw AppError.notFound(`No product has the code ${trimmed}`);
  }

  const branchStock =
    branchId === null
      ? null
      : ((
          await prisma.branchStock.findUnique({
            where: { productId_branchId: { productId: product.id, branchId } },
            select: { quantity: true },
          })
        )?.quantity ?? 0);

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    price: product.price.toFixed(2),
    branchStock,
    totalStock: product.stock,
    status: product.status,
  };
}
