import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import {
  getProductContent,
  PRODUCT_TRANSLATION_LOCALES,
  setProductTranslation,
} from '../../services/product-content.service.js';
import {
  getCatalogueVersion,
  listCatalogueVersions,
  restoreCatalogueVersion,
} from '../../services/product-catalogue-version.service.js';

export const productContentRouter = Router();

const guard = [authenticate, withBranchContext, requireArea('products')] as const;
const localeSchema = z.enum(PRODUCT_TRANSLATION_LOCALES);
const contentBody = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    metaTitle: z.string().trim().max(160).nullable().optional(),
    metaDescription: z.string().trim().max(320).nullable().optional(),
  })
  .strict();
const historyQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});
const versionParam = z.coerce.number().int().positive();
const restoreBody = z.object({ expectedUpdatedAt: z.string().datetime() }).strict();

productContentRouter.get('/products/:productId/content', ...guard, async (req, res) => {
  res.json({ data: await getProductContent(String(req.params.productId)) });
});

productContentRouter.put('/products/:productId/content/:locale', ...guard, async (req, res) => {
  const locale = localeSchema.safeParse(req.params.locale);
  const content = contentBody.safeParse(req.body);
  if (!locale.success || !content.success) {
    throw AppError.badRequest('Invalid localized product content', {
      locale: locale.success ? undefined : locale.error.flatten(),
      fields: content.success ? undefined : content.error.flatten(),
    });
  }

  res.json({
    data: await setProductTranslation(
      String(req.params.productId),
      locale.data,
      content.data,
      req,
    ),
  });
});

productContentRouter.get('/products/:productId/versions', ...guard, async (req, res) => {
  const query = historyQuery.safeParse(req.query);
  if (!query.success) throw AppError.badRequest('Invalid version history query', query.error.flatten());

  res.json({
    data: await listCatalogueVersions(
      String(req.params.productId),
      query.data.page,
      query.data.pageSize,
    ),
  });
});

productContentRouter.get('/products/:productId/versions/:version', ...guard, async (req, res) => {
  const version = versionParam.safeParse(req.params.version);
  if (!version.success) throw AppError.badRequest('Invalid catalogue version');

  res.json({
    data: await getCatalogueVersion(String(req.params.productId), version.data),
  });
});

productContentRouter.post('/products/:productId/versions/:version/restore', ...guard, async (req, res) => {
  const version = versionParam.safeParse(req.params.version);
  const body = restoreBody.safeParse(req.body);
  if (!version.success || !body.success) {
    throw AppError.badRequest('Invalid catalogue restore request');
  }

  res.json({
    data: await restoreCatalogueVersion(
      String(req.params.productId),
      version.data,
      body.data.expectedUpdatedAt,
      req,
    ),
  });
});
