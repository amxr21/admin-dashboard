import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  addImage,
  deleteImage,
  listImages,
  reorderImages,
} from '../../services/product-images.service.js';

/**
 * A product's image gallery — named routes, nested under a product like
 * variants, and for the same reason: always scoped to a parent, never a
 * standalone resource a client could list across every product at once.
 */

export const productImagesRouter = Router();

const guard = [authenticate, requireArea('products')] as const;

const addBody = z
  .object({
    url: z.string().trim().url('Enter a valid URL').max(512),
  })
  .strict();

const reorderBody = z
  .object({
    ids: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

productImagesRouter.get('/products/:productId/images', ...guard, async (req, res) => {
  res.json({ data: { images: await listImages(String(req.params.productId)) } });
});

productImagesRouter.post('/products/:productId/images', ...guard, async (req, res) => {
  const parsed = addBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const image = await addImage(String(req.params.productId), parsed.data.url, req);
  res.status(201).json({ data: { image } });
});

productImagesRouter.put('/products/:productId/images/order', ...guard, async (req, res) => {
  const parsed = reorderBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const images = await reorderImages(String(req.params.productId), parsed.data.ids, req);
  res.json({ data: { images } });
});

productImagesRouter.delete('/images/:id', ...guard, async (req, res) => {
  await deleteImage(String(req.params.id), req);
  res.status(204).send();
});
