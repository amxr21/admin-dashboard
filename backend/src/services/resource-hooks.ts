import type { Request } from 'express';
import { ProductStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../logger.js';
import { defaultBranchId } from './inventory.service.js';
import { normalizePhone } from '../lib/phone.js';
import { uniqueSlug } from '../lib/slug.js';
import { recordCatalogueVersion } from './product-catalogue-version.service.js';

/// The category tree's own cap (S7.6) — decided rather than left unbounded:
/// a shop's catalogue nav is Category → Subcategory → Sub-subcategory in
/// practice, a deeper tree serves no real storefront and would need the
/// tree-picker UI and any rollup report to handle arbitrary depth from day
/// one for no stated need.
const MAX_CATEGORY_DEPTH = 3;

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
   * Runs BEFORE a generic create or update reaches Prisma, given the WRITE
   * DATA (already validated against the config's field shapes) and — for an
   * update — the row's own id, so a hook can tell "moving myself under my
   * own descendant" apart from "setting my parent for the first time".
   * Throwing here refuses the write outright — this is the only hook that
   * CAN, since `afterCreate`/`afterUpdate` run once the row already exists
   * and rolling that back is not what those hooks are for. A resource with
   * no hook gets no extra validation beyond the config's own field rules.
   */
  beforeWrite?: (data: Record<string, unknown>, id: string | null) => Promise<void>;
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
  beforeDelete?: (id: string, req: Request) => Promise<DeleteOutcome>;
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
  customers: {
    beforeWrite: (data): Promise<void> => {
      if (!Object.prototype.hasOwnProperty.call(data, 'phone')) return Promise.resolve();
      const phone = data.phone;
      data.phoneNormalized = typeof phone === 'string' && phone.trim()
        ? normalizePhone(phone)
        : null;
      return Promise.resolve();
    },
  },
  categories: {
    /**
     * The category tree (S7.6): depth cap and circular-parent prevention.
     *
     * ─── WHY THIS RUNS BEFORE THE WRITE, NOT AFTER ────────────────────
     * A depth violation or a cycle has to REFUSE the write outright, and
     * `afterCreate`/`afterUpdate` only ever run once the row already exists
     * — by then the bad parent is already committed. This is the one hook
     * that can throw and have it mean "the write never happened".
     *
     * ─── DEPTH: WALK UP FROM THE PROPOSED PARENT ──────────────────────
     * A new/moved category's own depth is "however deep its parent already
     * sits, plus one". Walking up (parent, parent's parent, …) rather than
     * down avoids ever touching the whole tree — this resource is small,
     * but the cost should still be proportional to depth, not row count.
     *
     * ─── CYCLES: THE SAME WALK CATCHES THEM ───────────────────────────
     * If the walk ever reaches the category being written, the proposed
     * parent is a descendant of itself — moving a category under its own
     * subcategory. The depth walk and the cycle check are the same
     * traversal, so this fires ONE query per ancestor, not two passes.
     */
    beforeWrite: async (data: Record<string, unknown>, id: string | null): Promise<void> => {
      /**
       * Generate the slug on CREATE only (URG-027/032).
       *
       * `Category.slug` is REQUIRED and `@unique`, so a blank one is a hard
       * failure the administrator currently has to resolve by hand — which is
       * exactly the "adding a category feels strange" complaint. Same rule as
       * products: only on create, and never over a slug the user typed.
       *
       * Runs before the parent walk below because a slug clash and a cycle are
       * independent refusals; neither needs the other to have passed.
       */
      if (id === null) {
        const typed = typeof data.slug === 'string' ? data.slug.trim() : '';
        const name = typeof data.name === 'string' ? data.name.trim() : '';
        if (!typed && name) {
          const isTaken = async (candidate: string): Promise<boolean> => {
            const clash = await prisma.category.findUnique({
              where: { slug: candidate },
              select: { id: true },
            });
            return clash !== null;
          };

          const slug = await uniqueSlug(name, isTaken);

          /**
           * `Category.slug` is NOT NULL, unlike the product's. A name made
           * entirely of punctuation ("???") slugifies to an empty string, and
           * leaving the column unset there would reach Prisma as a raw
           * constraint violation — a 500 shaped like a bug rather than a
           * refusal anyone can act on. Fall back to a generated stem so the
           * create still succeeds with a real, unique, editable slug.
           */
          data.slug = slug || (await uniqueSlug('category', isTaken));
        }
      }

      const parentId = data.parentId;
      if (typeof parentId !== 'string') return; // Unset or explicitly null — no parent, no walk.

      if (parentId === id) {
        throw AppError.badRequest('A category cannot be its own parent', { field: 'parentId' });
      }

      let depth = 1; // The proposed parent's own depth, counted as we walk up.
      let cursor: string | null = parentId;

      while (cursor) {
        if (cursor === id) {
          throw AppError.badRequest(
            'That would move this category under one of its own subcategories',
            { field: 'parentId' },
          );
        }

        const ancestor: { parentId: string | null } | null = await prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });

        if (!ancestor) break; // A dangling id fails the FK constraint moments later anyway.

        if (ancestor.parentId) depth += 1;
        cursor = ancestor.parentId;
      }

      if (depth >= MAX_CATEGORY_DEPTH) {
        throw AppError.badRequest(
          `Categories can only nest ${String(MAX_CATEGORY_DEPTH)} levels deep`,
          { field: 'parentId', max: MAX_CATEGORY_DEPTH },
        );
      }
    },

    /**
     * Block deleting a category that still has children (S7.6) — the
     * owner's own call, over silently reparenting them. A delete that also
     * restructures the rest of the tree is a bigger, less obvious action
     * than "remove this one category", the same reasoning the last-branch
     * and last-owner guards elsewhere in this app already follow: never
     * silently lose structure.
     */
    beforeDelete: async (id: string): Promise<DeleteOutcome> => {
      const childCount = await prisma.category.count({ where: { parentId: id } });

      if (childCount > 0) {
        throw AppError.badRequest(
          'This category has subcategories — move or delete them first',
          { field: 'parentId', childCount },
        );
      }

      return { handled: false };
    },
  },
  products: {
    /**
     * Generate the slug on CREATE only (URG-027).
     *
     * ─── WHY ONLY ON CREATE ──────────────────────────────────────────
     * `admin.config.ts` carries a deliberate note that a slug is never
     * auto-derived from the name, because changing one records a
     * `ProductRedirect` and should be a conscious act rather than a side
     * effect of renaming a product. That rule still holds for every UPDATE —
     * this fills in the one case it was never really about: a brand-new
     * product where the user left the field blank and there is no previous
     * slug to redirect from.
     *
     * `id === null` is exactly the create signal: `createResourceRow` calls
     * this hook with null, `updateResourceRow` passes the row's own id.
     *
     * A slug the user TYPED is left alone in both cases — deliberate input
     * always wins over generation.
     */
    beforeWrite: async (data: Record<string, unknown>, id: string | null): Promise<void> => {
      if (id !== null) return; // Update: never rewrite an existing slug.

      const existing = typeof data.slug === 'string' ? data.slug.trim() : '';
      if (existing) return; // The user chose one; respect it.

      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name) return; // No name to derive from — the field stays null.

      const slug = await uniqueSlug(name, async (candidate) => {
        const clash = await prisma.product.findUnique({
          where: { slug: candidate },
          select: { id: true },
        });
        return clash !== null;
      });

      // An all-punctuation name slugifies to nothing; leave the column null
      // rather than storing an empty string that looks like a real value.
      if (slug) data.slug = slug;
    },

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
    afterCreate: async (row: Record<string, unknown>, req: Request): Promise<void> => {
      const quantity = typeof row.stock === 'number' ? row.stock : 0;

      // Nothing to place. A zero-stock product is the normal case for a
      // catalogue entry added before its first delivery, and writing a
      // 0 row would be indistinguishable from one that was counted.
      if (quantity > 0) {

      // The switcher's own branch FIRST (O9.18) — an owner creating a
      // product while scoped to "Marina" must have the opening stock land
      // at Marina, not at whatever `defaultBranchId()` happens to resolve
      // to. Only falls through to the shared default when the request
      // genuinely named no branch, same as every other write in this file.
      // Shares defaultBranchId() rather than picking a fallback branch here
      // — a second copy of "which branch when none is named" is free to
      // drift from the flagged-default rule F8.2 established.
        const branchId = req.branchId ?? (await defaultBranchId());

        await prisma.branchStock.upsert({
          where: { productId_branchId: { productId: String(row.id), branchId } },
          create: { productId: String(row.id), branchId, quantity },
        // A row already existing here is not expected on a create, but an
        // upsert costs nothing and a crash would be a worse answer than
        // recording the figure that was just entered.
          update: { quantity },
        });
      }

      await recordCatalogueVersion(String(row.id), 'CREATE', 'Created product', req);
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
    beforeDelete: async (id: string, req: Request): Promise<DeleteOutcome> => {
      const orderedCount = await prisma.orderItem.count({ where: { productId: id } });

      if (orderedCount === 0) return { handled: false };

      await prisma.product.update({
        where: { id },
        data: { status: ProductStatus.ARCHIVED },
      });

      await recordCatalogueVersion(id, 'UPDATE', 'Archived product', req);

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
      if (previousSlug && previousSlug !== nextSlug) {
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
      }

      const changed = Object.keys(after).filter(
        (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
      );
      if (changed.length > 0) {
        try {
          await recordCatalogueVersion(
            String(after.id),
            'UPDATE',
            `Updated ${changed.slice(0, 6).join(', ')}`,
            req,
          );
        } catch (error) {
          const detail = {
            event: 'product.catalogue_version.write_failed',
            productId: String(after.id),
            error: error instanceof Error ? error.message : String(error),
          };
          if (typeof req.log?.error === 'function') req.log.error(detail);
          else logger.error(detail);
        }
      }
    },
  },
};

export function hooksFor(resource: string): ResourceHooks | undefined {
  return RESOURCE_HOOKS[resource];
}
