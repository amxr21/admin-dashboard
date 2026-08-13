import type { Request } from 'express';
import { ProductStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

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
