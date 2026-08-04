import { StockMovementReason } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  adjustVariantStock,
  createVariant,
  deleteVariant,
  listVariantMovements,
  listVariants,
  reconcileVariant,
  updateVariant,
} from '../../services/variants.service.js';

/**
 * Product variants — named routes, not the generic engine: a variant is
 * always scoped to a parent product (create/list are nested under
 * `/products/:productId/variants`), and its stock follows the same
 * transactional movement-log write the generic engine has no vocabulary for
 * (see `orders`/`inventory` for the same reasoning).
 *
 * Two areas, matching how this app already splits catalogue edits from
 * stock edits: `products` guards name/sku/price and delete; `inventory`
 * guards the movement log, identical to how product-level stock works.
 */

export const variantsRouter = Router();

const catalogueGuard = [authenticate, requireArea('products')] as const;
const stockGuard = [authenticate, requireArea('inventory')] as const;

const MONEY_PATTERN = /^-?\d{1,8}(\.\d{1,2})?$/;

const variantBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    sku: z.string().trim().max(64).optional(),
    price: z.string().regex(MONEY_PATTERN, 'Enter a decimal amount with up to 2 decimal places'),
  })
  .strict();

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const adjustBody = z
  .object({
    delta: z.number().int().refine((value) => value !== 0, 'Enter a non-zero amount'),
    reason: z.nativeEnum(StockMovementReason, { message: 'Choose a reason' }),
    note: z.string().trim().max(255).optional(),
  })
  .strict();

variantsRouter.get('/products/:productId/variants', ...catalogueGuard, async (req, res) => {
  res.json({ data: { variants: await listVariants(String(req.params.productId)) } });
});

variantsRouter.post('/products/:productId/variants', ...catalogueGuard, async (req, res) => {
  const parsed = variantBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const variant = await createVariant(String(req.params.productId), parsed.data, req);
  res.status(201).json({ data: { variant } });
});

variantsRouter.patch('/variants/:id', ...catalogueGuard, async (req, res) => {
  const parsed = variantBody.partial().safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  if (Object.keys(parsed.data).length === 0) {
    throw AppError.badRequest('Provide at least one field to write');
  }

  const variant = await updateVariant(String(req.params.id), parsed.data, req);
  res.json({ data: { variant } });
});

variantsRouter.delete('/variants/:id', ...catalogueGuard, async (req, res) => {
  await deleteVariant(String(req.params.id), req);
  res.status(204).send();
});

variantsRouter.get('/variants/:id/movements', ...stockGuard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  res.json({ data: await listVariantMovements(String(req.params.id), parsed.data) });
});

variantsRouter.post('/variants/:id/movements', ...stockGuard, async (req, res) => {
  const parsed = adjustBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const user = requireUser(req);
  const variantId = String(req.params.id);

  const result = await adjustVariantStock(variantId, {
    delta: parsed.data.delta,
    reason: parsed.data.reason,
    note: parsed.data.note,
    actorId: user.id,
  });

  req.log.info({
    event: 'variant.stock.adjusted',
    variantId,
    delta: parsed.data.delta,
    reason: parsed.data.reason,
    stock: result.variant.stock,
    userId: user.id,
  });

  res.status(201).json({ data: result });
});

variantsRouter.get('/variants/:id/reconcile', ...stockGuard, async (req, res) => {
  res.json({ data: await reconcileVariant(String(req.params.id)) });
});
