import { StockMovementReason } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { toCsv } from '../../lib/csv.js';
import { audit } from '../../services/audit.service.js';
import {
  VARIANT_EXPORT_COLUMNS,
  VARIANT_IMPORT_COLUMNS,
  applyVariantImport,
  listVariantsForExport,
  previewVariantImport,
} from '../../services/variant-import.service.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
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

const catalogueGuard = [authenticate, withBranchContext, requireArea('products')] as const;
const stockGuard = [authenticate, withBranchContext, requireArea('inventory')] as const;

const MONEY_PATTERN = /^-?\d{1,8}(\.\d{1,2})?$/;

const variantBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    sku: z.string().trim().min(1, 'SKU cannot be blank').max(64).optional(),
    barcode: z.string().trim().min(1, 'Barcode cannot be blank').max(64).nullable().optional(),
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

/* ── CSV export / import (products area; stock is exported, never imported) ── */

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

function parseVariantUpload(req: Request, res: Response, next: NextFunction) {
  importUpload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      next(
        AppError.badRequest(
          err.code === 'LIMIT_FILE_SIZE' ? 'File is too large — the limit is 2MB' : err.message,
        ),
      );
      return;
    }
    next(err);
  });
}

function parseVariantCsv(req: Request): Record<string, string>[] {
  if (!req.file) {
    throw AppError.badRequest('No file uploaded — send it as multipart form field "file"');
  }
  try {
    return parseCsvSync(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    throw AppError.badRequest('Could not read this file as CSV. Check it matches the template.');
  }
}

variantsRouter.get('/variants/export', ...catalogueGuard, async (req, res) => {
  const rows = await listVariantsForExport(req.branchId ?? undefined);

  audit(req, { action: 'product_variants.export', entity: 'product_variants', entityId: null, changes: null });

  res
    .status(200)
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="variants.csv"')
    .send(toCsv(rows, VARIANT_EXPORT_COLUMNS));
});

variantsRouter.get('/variants/import-template', ...catalogueGuard, (_req, res) => {
  res
    .status(200)
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="variants-import-template.csv"')
    .send(`${VARIANT_IMPORT_COLUMNS.join(',')}\r\n`);
});

variantsRouter.post('/variants/import', ...catalogueGuard, parseVariantUpload, async (req, res) => {
  const rows = parseVariantCsv(req);

  if (req.query.dryRun === 'true') {
    res.status(200).json({ data: await previewVariantImport(rows) });
    return;
  }

  // 200 even with row errors — the same contract as the resource import.
  res.status(200).json({ data: await applyVariantImport(rows, req) });
});

variantsRouter.get('/products/:productId/variants', ...catalogueGuard, async (req, res) => {
  res.json({
    data: {
      variants: await listVariants(String(req.params.productId), req.branchId ?? undefined),
    },
  });
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

  const variant = await updateVariant(
    String(req.params.id),
    parsed.data,
    req,
    req.branchId ?? undefined,
  );
  res.json({ data: { variant } });
});

variantsRouter.delete('/variants/:id', ...catalogueGuard, async (req, res) => {
  await deleteVariant(String(req.params.id), req);
  res.status(204).send();
});

variantsRouter.get('/variants/:id/movements', ...stockGuard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());

  res.json({
    data: await listVariantMovements(
      String(req.params.id),
      parsed.data,
      req.branchId ?? undefined,
    ),
  });
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
  }, req, req.branchId ?? undefined);

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
  res.json({
    data: await reconcileVariant(String(req.params.id), req.branchId ?? undefined),
  });
});
