import { Prisma, ProductStatus, type Product } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

/**
 * Product catalogue operations.
 *
 * Routes stay thin — everything that makes a decision lives here so it can be
 * tested without HTTP, matching auth.service.ts.
 */

/**
 * ─── MONEY CROSSES THE WIRE AS A STRING ──────────────────────────────
 * `price` is Decimal(10,2). Prisma hands back a Decimal object, and
 * `JSON.stringify` would render it via its own `toJSON`. Converting to a JS
 * number instead is the trap: 0.1 + 0.2 arithmetic on the client silently
 * corrupts totals, and above 2^53 the value is simply wrong.
 *
 * The API therefore emits `"19.99"`, not `19.99`. Clients format it with Intl
 * and never do arithmetic on it — the server owns every total.
 */
export interface SerializedProduct extends Omit<Product, 'price'> {
  price: string;
}

export function serializeProduct(product: Product): SerializedProduct {
  return { ...product, price: product.price.toFixed(2) };
}

/** Hard ceiling on page size. Without it, `?limit=100000` is a scraping tool. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface ListProductsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProductStatus;
  categoryId?: string;
  sort?: 'name' | 'price' | 'stock' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface ListProductsResult {
  products: SerializedProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listProducts(
  params: ListProductsParams = {},
): Promise<ListProductsResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? DEFAULT_PAGE_SIZE));

  const search = params.search?.trim();

  const where: Prisma.ProductWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    // Search spans name and SKU because staff look products up by either.
    // Deliberately NOT description: it's a TEXT column with no index, so
    // including it turns every search into a full table scan.
    ...(search
      ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }] }
      : {}),
  };

  const orderBy = { [params.sort ?? 'createdAt']: params.order ?? 'desc' };

  // One round-trip, not two. A separate count can disagree with the page it
  // describes if a write lands between the queries.
  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: { category: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products: rows.map(serializeProduct),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getProductById(id: string): Promise<SerializedProduct> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: { select: { id: true, name: true, slug: true } } },
  });

  if (!product) throw AppError.notFound('Product not found');

  return serializeProduct(product);
}

export interface CreateProductInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  price: string;
  imageUrl?: string | null;
  status?: ProductStatus;
  stock?: number;
  categoryId?: string | null;
}

export async function createProduct(
  input: CreateProductInput,
): Promise<SerializedProduct> {
  await assertCategoryExists(input.categoryId);

  try {
    const product = await prisma.product.create({
      // `price` arrives as a string and is handed to Prisma as a string —
      // never parsed through a JS number on the way in.
      data: { ...input, price: new Prisma.Decimal(input.price) },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    return serializeProduct(product);
  } catch (error) {
    throw translateKnownErrors(error, input.sku);
  }
}

export type UpdateProductInput = Partial<CreateProductInput>;

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<SerializedProduct> {
  // Existence is checked first so a bad id returns 404 rather than Prisma's
  // P2025, which the error handler would surface as a 500.
  await getProductById(id);
  await assertCategoryExists(input.categoryId);

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...input,
        ...(input.price === undefined ? {} : { price: new Prisma.Decimal(input.price) }),
      },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    return serializeProduct(product);
  } catch (error) {
    throw translateKnownErrors(error, input.sku);
  }
}

export interface DeleteProductResult {
  /** True when the row was archived instead of removed. */
  archived: boolean;
  product: SerializedProduct;
}

/**
 * Removing a product ARCHIVES it when it appears in any order.
 *
 * OrderItem.productId is SetNull, so a hard delete would leave historical
 * order lines pointing at nothing. Those lines keep their price snapshot but
 * have no name snapshot, so the order would render a blank row — silently
 * rewriting a customer's order history, which is the kind of damage nobody
 * notices until an invoice is disputed.
 *
 * Products never ordered are genuinely deleted: they are catalogue mistakes,
 * and keeping them clutters every list forever.
 */
export async function deleteProduct(id: string): Promise<DeleteProductResult> {
  await getProductById(id);

  const orderedCount = await prisma.orderItem.count({ where: { productId: id } });

  if (orderedCount > 0) {
    const archived = await prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    return { archived: true, product: serializeProduct(archived) };
  }

  const removed = await prisma.product.delete({
    where: { id },
    include: { category: { select: { id: true, name: true, slug: true } } },
  });

  return { archived: false, product: serializeProduct(removed) };
}

/**
 * A categoryId that doesn't exist would surface as a foreign-key violation —
 * a 500 that tells the user nothing. Checking first turns it into a 400 naming
 * the field.
 */
async function assertCategoryExists(categoryId?: string | null): Promise<void> {
  if (!categoryId) return;

  const exists = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });

  if (!exists) throw AppError.badRequest('Category not found', { categoryId });
}

/**
 * `sku` is unique. A duplicate is a normal thing for a user to do, so it gets
 * a 409 naming the field — not a 500 leaking the Prisma error and the schema
 * along with it.
 */
function translateKnownErrors(error: unknown, sku?: string | null): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    sku
  ) {
    return AppError.conflict('A product with this SKU already exists', { sku });
  }

  return error;
}
