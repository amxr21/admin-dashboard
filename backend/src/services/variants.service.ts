import { Prisma, type StockMovementReason } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit, diff } from './audit.service.js';
import { defaultBranchId } from './inventory.service.js';
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

export async function listVariants(productId: string, branchId?: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw AppError.notFound('Product not found');

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      stock: true,
      productId: true,
      createdAt: true,
      updatedAt: true,
      // Always select the relation so Prisma's result type is stable. For an
      // unscoped business-wide read the row is ignored; the global running
      // total below remains the source of truth.
      branchStock: {
        where: { branchId: branchId ?? '__business_wide__' },
        select: { quantity: true },
        take: 1,
      },
    },
  });

  return variants.map((variant) => serializeVariant({
    ...variant,
    stock: branchId ? (variant.branchStock[0]?.quantity ?? 0) : variant.stock,
  }));
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
  branchId?: string,
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

    const branchStock = branchId
      ? await prisma.branchVariantStock.findUnique({
          where: { variantId_branchId: { variantId: id, branchId } },
          select: { quantity: true },
        })
      : null;

    return serializeVariant({
      ...variant,
      stock: branchId ? (branchStock?.quantity ?? 0) : variant.stock,
    });
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
  branchId?: string,
) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      branchStock: {
        where: { branchId: branchId ?? '__business_wide__' },
        select: { quantity: true },
        take: 1,
      },
    },
  });
  if (!variant) throw AppError.notFound('Variant not found');

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const [movements, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where: { variantId, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, delta: true, reason: true, note: true, actorId: true, createdAt: true },
    }),
    prisma.stockMovement.count({ where: { variantId, ...(branchId ? { branchId } : {}) } }),
  ]);

  // Same batched, read-time resolution as the product-level movement log
  // (inventory.service.ts's `listMovements`) — `actorId` is a plain id, not
  // a relation, so the trail survives the staff member being deleted; the
  // name is a display convenience resolved here, not evidence snapshotted
  // at write time.
  const actorIds = [
    ...new Set(movements.map((m) => m.actorId).filter((id): id is string => id !== null)),
  ];
  const actors =
    actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name ?? actor.email]));

  return {
    variant: {
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      stock: branchId ? (variant.branchStock[0]?.quantity ?? 0) : variant.stock,
    },
    movements: movements.map((movement) => ({
      ...movement,
      actorName: movement.actorId ? (actorNames.get(movement.actorId) ?? null) : null,
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

export async function adjustVariantStock(
  variantId: string,
  input: AdjustVariantStockInput,
  req: Request,
  branchId?: string,
) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw AppError.badRequest('Enter a whole number that is not zero', { field: 'delta' });
  }

  const writeBranchId = branchId ?? (await defaultBranchId());
  if (!writeBranchId) {
    throw AppError.badRequest('Select a branch before adjusting variant stock', {
      field: 'branchId',
      reason: 'BRANCH_REQUIRED',
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, stock: true },
    });
    if (!variant) throw AppError.notFound('Variant not found');

    const movement = await tx.stockMovement.create({
      data: {
        variantId,
        branchId: writeBranchId,
        delta: input.delta,
        reason: input.reason,
        note: input.note ?? null,
        actorId: input.actorId,
      },
      select: { id: true, delta: true, reason: true, note: true, actorId: true, createdAt: true },
    });

    let branchQuantity: number;
    if (input.delta > 0) {
      const branchStock = await tx.branchVariantStock.upsert({
        where: { variantId_branchId: { variantId, branchId: writeBranchId } },
        create: { variantId, branchId: writeBranchId, quantity: input.delta },
        update: { quantity: { increment: input.delta } },
        select: { quantity: true },
      });
      branchQuantity = branchStock.quantity;
    } else {
      const amount = -input.delta;
      const claimed = await tx.branchVariantStock.updateMany({
        where: { variantId, branchId: writeBranchId, quantity: { gte: amount } },
        data: { quantity: { decrement: amount } },
      });

      if (claimed.count === 0) {
        const current = await tx.branchVariantStock.findUnique({
          where: { variantId_branchId: { variantId, branchId: writeBranchId } },
          select: { quantity: true },
        });
        const available = current?.quantity ?? 0;
        throw AppError.badRequest(
          `Only ${available} in stock at this branch — that adjustment is too large`,
          { field: 'delta', available },
        );
      }

      const current = await tx.branchVariantStock.findUniqueOrThrow({
        where: { variantId_branchId: { variantId, branchId: writeBranchId } },
        select: { quantity: true },
      });
      branchQuantity = current.quantity;
    }

    if (input.delta < 0) {
      const updatedGlobal = await tx.productVariant.updateMany({
        where: { id: variantId, stock: { gte: -input.delta } },
        data: { stock: { increment: input.delta } },
      });
      if (updatedGlobal.count === 0) {
        throw AppError.conflict('Variant inventory totals are out of sync; reconcile before adjusting');
      }
    } else {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: { increment: input.delta } },
      });
    }

    const updated = await tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { id: true, name: true, sku: true, stock: true },
    });

    return {
      variant: { ...updated, stock: branchId ? branchQuantity : updated.stock },
      movement: { ...movement, createdAt: movement.createdAt.toISOString() },
    };
  });

  // Same reasoning as `adjustStock` in inventory.service.ts (F6.2) — the
  // movement's own `actorId` was never enough to make it visible in
  // /admin/audit or countable in getStaffActivity. After the transaction, so
  // a rolled-back movement leaves no audit entry behind.
  audit(req, {
    action: 'inventory.variant-stock.adjusted',
    entity: 'product_variants',
    entityId: result.variant.id,
    changes: {
      stock: { from: result.variant.stock - result.movement.delta, to: result.variant.stock },
      delta: { to: result.movement.delta },
      reason: { to: result.movement.reason },
      note: { to: result.movement.note },
      movementId: { to: result.movement.id },
    },
  });

  return result;
}

export async function reconcileVariant(variantId: string, branchId?: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      stock: true,
      branchStock: {
        where: { branchId: branchId ?? '__business_wide__' },
        select: { quantity: true },
        take: 1,
      },
    },
  });
  if (!variant) throw AppError.notFound('Variant not found');

  const sum = await prisma.stockMovement.aggregate({
    where: { variantId, ...(branchId ? { branchId } : {}) },
    _sum: { delta: true },
  });
  const fromMovements = sum._sum.delta ?? 0;

  return {
    variantId,
    stock: branchId ? (variant.branchStock[0]?.quantity ?? 0) : variant.stock,
    fromMovements,
    agrees: (branchId ? (variant.branchStock[0]?.quantity ?? 0) : variant.stock) === fromMovements,
  };
}
