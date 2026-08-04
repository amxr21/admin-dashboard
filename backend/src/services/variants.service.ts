import { Prisma, type StockMovementReason } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit, diff } from './audit.service.js';
import type { Request } from 'express';

/**
 * Product variants — a flat row ("Red / Large") with its own price, stock
 * and SKU, not an attribute matrix. Inventory-only in this pass: no relation
 * to `OrderItem` — this codebase has no real checkout flow to wire a variant
 * selection into (see the `Discount` model's own note on the same gap).
 *
 * Stock follows the EXACT same append-only movement-log pattern as
 * `Product.stock` (see `inventory.service.ts`) rather than a plain editable
 * number — deliberately, to stay consistent with the one rule this app holds
 * to everywhere else stock appears. Most of this file is that file's shape,
 * re-scoped to `productVariant`/`variantId`.
 */

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function serializeVariant(variant: {
  id: string;
  name: string;
  sku: string | null;
  price: Prisma.Decimal;
  stock: number;
  productId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...variant,
    price: money(variant.price),
    createdAt: variant.createdAt.toISOString(),
    updatedAt: variant.updatedAt.toISOString(),
  };
}

export async function listVariants(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw AppError.notFound('Product not found');

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    orderBy: { createdAt: 'asc' },
  });

  return variants.map(serializeVariant);
}

export interface VariantInput {
  name: string;
  sku?: string | null;
  price: string;
}

export async function createVariant(productId: string, input: VariantInput, req: Request) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw AppError.notFound('Product not found');

  try {
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        name: input.name,
        sku: input.sku ?? null,
        price: new Prisma.Decimal(input.price),
      },
    });

    audit(req, {
      action: 'variant.create',
      entity: 'product_variants',
      entityId: variant.id,
      changes: diff({}, serializeVariant(variant)),
    });

    return serializeVariant(variant);
  } catch (error) {
    throw translateVariantWriteError(error);
  }
}

export async function updateVariant(
  id: string,
  input: Partial<VariantInput>,
  req: Request,
) {
  const before = await prisma.productVariant.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Variant not found');

  const data: Prisma.ProductVariantUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.price !== undefined) data.price = new Prisma.Decimal(input.price);

  try {
    const variant = await prisma.productVariant.update({ where: { id }, data });

    const changes = diff(serializeVariant(before), serializeVariant(variant));
    if (Object.keys(changes).length > 0) {
      audit(req, {
        action: 'variant.update',
        entity: 'product_variants',
        entityId: id,
        changes,
      });
    }

    return serializeVariant(variant);
  } catch (error) {
    throw translateVariantWriteError(error);
  }
}

export async function deleteVariant(id: string, req: Request) {
  const before = await prisma.productVariant.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Variant not found');

  await prisma.productVariant.delete({ where: { id } });

  audit(req, {
    action: 'variant.delete',
    entity: 'product_variants',
    entityId: id,
    changes: null,
  });
}

function translateVariantWriteError(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return error;
  }
  return AppError.conflict('Another variant already uses this SKU', { fields: ['sku'] });
}

/* ── Stock, identical shape to inventory.service.ts, scoped to a variant ── */

export async function listVariantMovements(
  variantId: string,
  params: { page?: number; pageSize?: number } = {},
) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, name: true, sku: true, stock: true },
  });
  if (!variant) throw AppError.notFound('Variant not found');

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const [movements, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, delta: true, reason: true, note: true, actorId: true, createdAt: true },
    }),
    prisma.stockMovement.count({ where: { variantId } }),
  ]);

  return {
    variant,
    movements: movements.map((movement) => ({
      ...movement,
      createdAt: movement.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface AdjustVariantStockInput {
  delta: number;
  reason: StockMovementReason;
  note?: string | undefined;
  actorId: string;
}

export async function adjustVariantStock(variantId: string, input: AdjustVariantStockInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw AppError.badRequest('Enter a whole number that is not zero', { field: 'delta' });
  }

  return prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, stock: true },
    });
    if (!variant) throw AppError.notFound('Variant not found');

    const next = variant.stock + input.delta;
    if (next < 0) {
      throw AppError.badRequest(
        `Only ${variant.stock} in stock — that would leave ${next}`,
        { field: 'delta', available: variant.stock },
      );
    }

    const movement = await tx.stockMovement.create({
      data: {
        variantId,
        delta: input.delta,
        reason: input.reason,
        note: input.note ?? null,
        actorId: input.actorId,
      },
      select: { id: true, delta: true, reason: true, note: true, actorId: true, createdAt: true },
    });

    const updated = await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: next },
      select: { id: true, name: true, sku: true, stock: true },
    });

    return {
      variant: updated,
      movement: { ...movement, createdAt: movement.createdAt.toISOString() },
    };
  });
}

export async function reconcileVariant(variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, stock: true },
  });
  if (!variant) throw AppError.notFound('Variant not found');

  const sum = await prisma.stockMovement.aggregate({
    where: { variantId },
    _sum: { delta: true },
  });
  const fromMovements = sum._sum.delta ?? 0;

  return {
    variantId,
    stock: variant.stock,
    fromMovements,
    agrees: variant.stock === fromMovements,
  };
}
