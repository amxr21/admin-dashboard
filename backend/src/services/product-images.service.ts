import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import type { Request } from 'express';

/**
 * Additional catalogue images beyond `Product.imageUrl` (the "cover" image,
 * unchanged — still what every list/cell renders). A real ordered model, not
 * a JSON array — see the schema comment on `ProductImage` for why.
 */

function serializeImage(image: {
  id: string;
  url: string;
  alt: string | null;
  position: number;
  productId: string;
  createdAt: Date;
}) {
  return { ...image, createdAt: image.createdAt.toISOString() };
}

export async function listImages(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw AppError.notFound('Product not found');

  const images = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { position: 'asc' },
  });

  return images.map(serializeImage);
}

export async function addImage(
  productId: string,
  url: string,
  alt: string | null,
  req: Request,
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw AppError.notFound('Product not found');

  const last = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  const position = (last._max.position ?? -1) + 1;

  const image = await prisma.productImage.create({
    data: { productId, url, alt, position },
  });

  audit(req, {
    action: 'product.image.added',
    entity: 'product_images',
    entityId: image.id,
    changes: { url: { from: null, to: url }, alt: { from: null, to: alt } },
  });

  return serializeImage(image);
}

/**
 * Alt text is the only field an existing image can be edited through — url
 * and position have their own dedicated flows (delete-and-re-add, reorder),
 * and folding either into a generic "update" would blur which one actually
 * happened in the audit trail.
 */
export async function setImageAlt(id: string, alt: string | null, req: Request) {
  const existing = await prisma.productImage.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('Image not found');

  const image = await prisma.productImage.update({ where: { id }, data: { alt } });

  audit(req, {
    action: 'product.image.alt_updated',
    entity: 'product_images',
    entityId: id,
    changes: { alt: { from: existing.alt, to: alt } },
  });

  return serializeImage(image);
}

/**
 * Re-numbers every image for a product to match the given order.
 *
 * Takes the FULL ordered id list rather than "move this one to position N" —
 * a drag-and-drop reorder already knows the complete new order, and
 * re-deriving it from a series of single-position moves is more state to get
 * wrong for no benefit here.
 */
export async function reorderImages(productId: string, orderedIds: string[], req: Request) {
  const existing = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((image) => image.id));

  if (
    orderedIds.length !== existingIds.size ||
    orderedIds.some((id) => !existingIds.has(id)) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    throw AppError.badRequest('The image list must name every image for this product exactly once');
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.productImage.update({ where: { id }, data: { position: index } }),
    ),
  );

  audit(req, {
    action: 'product.images.reordered',
    entity: 'product_images',
    entityId: productId,
    changes: { order: { from: null, to: orderedIds } },
  });

  return listImages(productId);
}

export async function deleteImage(id: string, req: Request) {
  const image = await prisma.productImage.findUnique({ where: { id } });
  if (!image) throw AppError.notFound('Image not found');

  await prisma.productImage.delete({ where: { id } });

  audit(req, {
    action: 'product.image.removed',
    entity: 'product_images',
    entityId: id,
    changes: null,
  });
}
