import { ProductStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';

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
   * Runs INSTEAD of the generic delete when it returns `handled: true`.
   * Returning `handled: false` falls through to the normal delete.
   */
  beforeDelete?: (id: string) => Promise<DeleteOutcome>;
}

export const RESOURCE_HOOKS: Readonly<Record<string, ResourceHooks | undefined>> = {
  products: {
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
  },
};

export function hooksFor(resource: string): ResourceHooks | undefined {
  return RESOURCE_HOOKS[resource];
}
