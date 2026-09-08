import type { Request } from 'express';
import { ProductStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { defaultBranchId } from './inventory.service.js';

/**
 * Resource-specific BEHAVIOUR.
 *
 * ─── WHY THIS IS CODE AND NOT CONFIG ─────────────────────────────────
 * admin.config.ts describes the SHAPE of data — which fields exist, which
 * values are legal, who may access it. That is all data, so it lives in data.
 *
 * What happens when a row changes is a PROCEDURE: read another table, decide,
 * write two rows in one transaction. Expressing that in config would mean
 * inventing syntax for "then", "if" and "in a transaction" — at which point the
 * config file is a programming language with no type checker, no tests and no
 * debugger. TypeScript already does this, with all three.
 *
 * So: config for shape, hooks for behaviour. A resource with no hook gets the
 * plain generic behaviour, which is the common case.
 */

export interface DeleteOutcome {
  /** True when the hook handled the delete itself. */
  handled: boolean;
  /** Set when `handled` — what actually happened, for the response and the log. */
  action?: 'archived';
}

export interface ResourceHooks {
  /**
   * Runs AFTER a successful generic create, given the row as written.
   * Side-effect only, and awaited rather than fire-and-forget where the
   * side effect is part of what the row MEANS — see the products hook.
   */
  afterCreate?: (row: Record<string, unknown>, req: Request) => Promise<void>;
  /**
   * Runs INSTEAD of the generic delete when it returns `handled: true`.
   * Returning `handled: false` falls through to the normal delete.
   */
  beforeDelete?: (id: string) => Promise<DeleteOutcome>;
  /**
   * Runs AFTER a successful generic update, given the row as it was before
   * and after. Side-effect only — return value is ignored, and a throw here
   * must never undo the update that already committed (see the products
   * hook's own try/catch for why).
   */
  afterUpdate?: (
    id: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    req: Request,
  ) => Promise<void>;
}

export const RESOURCE_HOOKS: Readonly<Record<string, ResourceHooks | undefined>> = {
  products: {
    /**
     * Give the opening stock a BRANCH (O9.1).
     *
     * ─── THE BUG THIS FIXES ──────────────────────────────────────────
     * Two numbers describe stock: `Product.stock` (the all-branches total,
     * what the product list shows) and `BranchStock.quantity` (what one
     * branch holds, what the TILL reads). Creating a product wrote only the
     * first. `branchStock.upsert` was called in exactly three places —
     * adjustStock, a POS sale, a return restock — and all three are
     * MOVEMENTS. Nothing ran on the way in.
     *
     * So a product created with 40 in stock had `Product.stock = 40` and no
     * BranchStock row at all, and `scanProduct` reads a missing row as 0
     * (correctly — see the comment in inventory.service.ts: no row genuinely
     * means this branch holds none of it). Every product added through the
     * UI therefore scanned as out of stock and fired the over-stock warning
     * on the first unit. The read was never wrong; the entry path was.
     *
     * ─── WHY NOT adjustStock() ───────────────────────────────────────
     * Because the create already wrote `Product.stock`. adjustStock moves
     * BOTH totals, so calling it here would leave the product claiming twice
     * the stock that was entered. This writes the branch row ONLY, to the
     * figure the product was created with — it is not a movement, it is the
     * same fact recorded at the grain the till reads.
     *
     * No StockMovement row either, for the same reason: nothing moved. The
     * opening figure is the product's starting state, and inventing a
     * RECEIVED movement would put stock in the ledger that no one received.
     *
     * ─── WHY THIS ONE IS AWAITED ─────────────────────────────────────
     * Unlike afterUpdate's redirect (history — nice to have), this is part of
     * what the created row MEANS. A product whose stock is invisible at the
     * till is broken, so a failure here must surface rather than be logged
     * and swallowed.
     */
    afterCreate: async (row: Record<string, unknown>): Promise<void> => {
      const quantity = typeof row.stock === 'number' ? row.stock : 0;

      // Nothing to place. A zero-stock product is the normal case for a
      // catalogue entry added before its first delivery, and writing a
      // 0 row would be indistinguishable from one that was counted.
      if (quantity <= 0) return;

      // Shares defaultBranchId() with every other write rather than picking a
      // branch here — a second copy of "which branch when none is named" is
      // free to drift from the flagged-default rule F8.2 established.
      const branchId = await defaultBranchId();

      await prisma.branchStock.upsert({
        where: { productId_branchId: { productId: String(row.id), branchId } },
        create: { productId: String(row.id), branchId, quantity },
        // A row already existing here is not expected on a create, but an
        // upsert costs nothing and a crash would be a worse answer than
        // recording the figure that was just entered.
        update: { quantity },
      });
    },

    /**
     * Archive rather than delete when the product appears in any order.
     *
     * OrderItem.productId is SetNull, so a hard delete would blank the line
     * item in a past order. Line items carry a price snapshot but no name
     * snapshot, so that order would render a nameless row — silently rewriting
     * a customer's order history, which nobody notices until an invoice is
     * disputed.
     *
     * Products never ordered are genuinely deleted: they are catalogue
     * mistakes, and keeping them clutters every list forever.
     */
    beforeDelete: async (id: string): Promise<DeleteOutcome> => {
      const orderedCount = await prisma.orderItem.count({ where: { productId: id } });

      if (orderedCount === 0) return { handled: false };

      await prisma.product.update({
        where: { id },
        data: { status: ProductStatus.ARCHIVED },
      });

      return { handled: true, action: 'archived' };
    },

    /**
     * Records the OLD slug whenever a product's slug changes away from a
     * previously-set value — never on the first slug being assigned (there
     * is no "old" one to redirect from). See the schema comment on
     * `ProductRedirect` for why nothing consumes this live today.
     *
     * Best-effort, same discipline as `audit()`: a redirect row is history,
     * not the update itself — a failure here (e.g. the freakishly unlucky
     * case of the old slug already existing as ANOTHER product's current
     * redirect) must never make the slug update the user just performed
     * look like it failed.
     */
    afterUpdate: async (
      _id: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>,
      req: Request,
    ): Promise<void> => {
      const previousSlug = typeof before.slug === 'string' ? before.slug : null;
      const nextSlug = typeof after.slug === 'string' ? after.slug : null;
      if (!previousSlug || previousSlug === nextSlug) return;

      try {
        await prisma.productRedirect.create({
          data: { oldSlug: previousSlug, productId: String(after.id) },
        });
      } catch (error) {
        const detail = {
          event: 'product.redirect.write_failed',
          productId: String(after.id),
          oldSlug: previousSlug,
          error: error instanceof Error ? error.message : String(error),
        };
        if (typeof req.log?.error === 'function') req.log.error(detail);
        else logger.error(detail);
      }
    },
  },
};

export function hooksFor(resource: string): ResourceHooks | undefined {
  return RESOURCE_HOOKS[resource];
}
