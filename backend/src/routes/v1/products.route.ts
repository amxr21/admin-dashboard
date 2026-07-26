import { Router } from 'express';
import { ProductStatus } from '@prisma/client';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  MAX_PAGE_SIZE,
  updateProduct,
} from '../../services/products.service.js';

/**
 * Product catalogue.
 *
 * Every route is `authenticate` then `requireArea('products')`. Writes are
 * additionally blocked for read-only roles inside `authenticate` itself — see
 * middleware/authorize.ts for why that check cannot live at app level.
 */

export const productsRouter = Router();

/**
 * Money as a STRING, validated as a decimal.
 *
 * Accepting a JSON number here would already have lost precision by the time
 * Zod saw it — the parse happens in JSON.parse, before any validation runs.
 * The string form is exact all the way to Prisma.Decimal.
 */
const priceSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Price must be a number with up to 2 decimal places');

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
    search: z.string().max(200).optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    categoryId: z.string().optional(),
    sort: z.enum(['name', 'price', 'stock', 'createdAt']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(200),
    sku: z.string().max(64).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    price: priceSchema,
    imageUrl: z.string().url('Must be a valid URL').max(512).nullable().optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    // Negative stock is not a real quantity. It usually means a bad import.
    stock: z.number().int().min(0).optional(),
    categoryId: z.string().nullable().optional(),
  })
  .strict();

// Every field optional, but at least one required — an empty PATCH is almost
// always a client bug, and silently returning 200 hides it.
const updateSchema = createSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update' },
);

// GET /api/v1/products
productsRouter.get(
  '/products',
  authenticate,
  requireArea('products'),
  async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid query parameters', parsed.error.flatten());
    }

    const result = await listProducts(parsed.data);

    res.status(200).json({ data: result });
  },
);

// GET /api/v1/products/:id
productsRouter.get(
  '/products/:id',
  authenticate,
  requireArea('products'),
  async (req, res) => {
    const product = await getProductById(String(req.params.id));

    res.status(200).json({ data: { product } });
  },
);

// POST /api/v1/products
productsRouter.post(
  '/products',
  authenticate,
  requireArea('products'),
  async (req, res) => {
    const parsed = createSchema.safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid product', parsed.error.flatten());
    }

    const product = await createProduct(parsed.data);

    req.log.info({ event: 'product.created', productId: product.id });

    res.status(201).json({ data: { product } });
  },
);

// PATCH /api/v1/products/:id
productsRouter.patch(
  '/products/:id',
  authenticate,
  requireArea('products'),
  async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success) {
      throw AppError.badRequest('Invalid product', parsed.error.flatten());
    }

    const product = await updateProduct(String(req.params.id), parsed.data);

    req.log.info({ event: 'product.updated', productId: product.id });

    res.status(200).json({ data: { product } });
  },
);

// DELETE /api/v1/products/:id
productsRouter.delete(
  '/products/:id',
  authenticate,
  requireArea('products'),
  async (req, res) => {
    const { archived, product } = await deleteProduct(String(req.params.id));

    // The response says WHICH happened, so the UI can tell the user "archived
    // because it appears in past orders" instead of claiming it was deleted.
    req.log.info({
      event: archived ? 'product.archived' : 'product.deleted',
      productId: product.id,
    });

    res.status(200).json({ data: { archived, product } });
  },
);
