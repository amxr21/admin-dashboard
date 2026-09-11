import type { Request } from 'express';
import { Prisma, ProductStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';

export type CatalogueVersionSource = 'CREATE' | 'UPDATE' | 'TRANSLATION' | 'RESTORE';

const nullableText = z.string().nullable();
const snapshotSchema = z.object({
  name: z.string().min(1).max(200),
  sku: nullableText,
  description: nullableText,
  price: z.string(),
  cost: nullableText,
  imageUrl: nullableText,
  status: z.nativeEnum(ProductStatus),
  lowStockThreshold: z.number().int().nullable(),
  storageLocation: nullableText,
  categoryId: nullableText,
  barcode: nullableText,
  weightKg: nullableText,
  lengthCm: nullableText,
  widthCm: nullableText,
  heightCm: nullableText,
  hsCode: nullableText,
  countryOfOrigin: nullableText,
  slug: nullableText,
  metaTitle: nullableText,
  metaDescription: nullableText,
  tagIds: z.array(z.string()),
  translations: z.array(
    z.object({
      locale: z.string().min(1).max(10),
      name: nullableText,
      description: nullableText,
      metaTitle: nullableText,
      metaDescription: nullableText,
    }),
  ),
});

type CatalogueSnapshot = z.infer<typeof snapshotSchema>;

const snapshotSelect = {
  name: true,
  sku: true,
  description: true,
  price: true,
  cost: true,
  imageUrl: true,
  status: true,
  lowStockThreshold: true,
  storageLocation: true,
  categoryId: true,
  barcode: true,
  weightKg: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  hsCode: true,
  countryOfOrigin: true,
  slug: true,
  metaTitle: true,
  metaDescription: true,
  tags: { select: { id: true }, orderBy: { id: 'asc' as const } },
  translations: {
    select: {
      locale: true,
      name: true,
      description: true,
      metaTitle: true,
      metaDescription: true,
    },
    orderBy: { locale: 'asc' as const },
  },
} satisfies Prisma.ProductSelect;

async function captureSnapshot(tx: Prisma.TransactionClient, productId: string): Promise<CatalogueSnapshot> {
  const product = await tx.product.findUnique({ where: { id: productId }, select: snapshotSelect });
  if (!product) throw AppError.notFound('Product not found');

  const decimal = (value: Prisma.Decimal | null) => value?.toString() ?? null;
  const { tags, ...content } = product;
  return {
    ...content,
    price: product.price.toString(),
    cost: decimal(product.cost),
    weightKg: decimal(product.weightKg),
    lengthCm: decimal(product.lengthCm),
    widthCm: decimal(product.widthCm),
    heightCm: decimal(product.heightCm),
    tagIds: tags.map((tag) => tag.id),
    translations: product.translations,
  };
}

function actor(req: Request) {
  return {
    actorId: req.user?.id ?? null,
    actorEmail: req.user?.email ?? null,
    actorRole: req.user?.role ?? null,
  };
}

export async function recordCatalogueVersion(
  productId: string,
  source: CatalogueVersionSource,
  summary: string,
  req: Request,
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({
      where: { id: productId },
      data: { catalogueVersion: { increment: 1 } },
      select: { catalogueVersion: true },
    });
    const snapshot = await captureSnapshot(tx, productId);
    return tx.productCatalogueVersion.create({
      data: {
        productId,
        version: product.catalogueVersion,
        source,
        summary: summary.slice(0, 255),
        snapshot,
        ...actor(req),
      },
    });
  });
}

export async function listCatalogueVersions(productId: string, page = 1, pageSize = 20) {
  const exists = await prisma.product.count({ where: { id: productId } });
  if (exists === 0) throw AppError.notFound('Product not found');

  const safePage = Math.max(1, page);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const [versions, total] = await Promise.all([
    prisma.productCatalogueVersion.findMany({
      where: { productId },
      orderBy: { version: 'desc' },
      skip: (safePage - 1) * safeSize,
      take: safeSize,
      select: {
        id: true,
        version: true,
        source: true,
        summary: true,
        actorEmail: true,
        actorRole: true,
        createdAt: true,
      },
    }),
    prisma.productCatalogueVersion.count({ where: { productId } }),
  ]);

  return {
    versions: versions.map((version) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
    })),
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export async function getCatalogueVersion(productId: string, versionNumber: number) {
  const [version, product] = await Promise.all([
    prisma.productCatalogueVersion.findUnique({
      where: { productId_version: { productId, version: versionNumber } },
    }),
    prisma.product.findUnique({ where: { id: productId }, select: { updatedAt: true } }),
  ]);
  if (!product) throw AppError.notFound('Product not found');
  if (!version) throw AppError.notFound('Catalogue version not found');

  return {
    ...version,
    createdAt: version.createdAt.toISOString(),
    currentUpdatedAt: product.updatedAt.toISOString(),
  };
}

export async function restoreCatalogueVersion(
  productId: string,
  versionNumber: number,
  expectedUpdatedAt: string,
  req: Request,
) {
  try {
    const restored = await prisma.$transaction(async (tx) => {
      const [current, version] = await Promise.all([
        tx.product.findUnique({ where: { id: productId }, select: { updatedAt: true } }),
        tx.productCatalogueVersion.findUnique({
          where: { productId_version: { productId, version: versionNumber } },
        }),
      ]);
      if (!current) throw AppError.notFound('Product not found');
      if (!version) throw AppError.notFound('Catalogue version not found');
      if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw AppError.conflict('This product changed after the restore preview was loaded');
      }

      const parsed = snapshotSchema.safeParse(version.snapshot);
      if (!parsed.success) throw AppError.conflict('This catalogue version cannot be restored safely');
      const snapshot = parsed.data;

      const product = await tx.product.update({
        where: { id: productId },
        data: {
          name: snapshot.name,
          sku: snapshot.sku,
          description: snapshot.description,
          price: snapshot.price,
          cost: snapshot.cost,
          imageUrl: snapshot.imageUrl,
          status: snapshot.status,
          lowStockThreshold: snapshot.lowStockThreshold,
          storageLocation: snapshot.storageLocation,
          categoryId: snapshot.categoryId,
          barcode: snapshot.barcode,
          weightKg: snapshot.weightKg,
          lengthCm: snapshot.lengthCm,
          widthCm: snapshot.widthCm,
          heightCm: snapshot.heightCm,
          hsCode: snapshot.hsCode,
          countryOfOrigin: snapshot.countryOfOrigin,
          slug: snapshot.slug,
          metaTitle: snapshot.metaTitle,
          metaDescription: snapshot.metaDescription,
          tags: { set: snapshot.tagIds.map((id) => ({ id })) },
          translations: {
            deleteMany: {},
            create: snapshot.translations.map((translation) => translation),
          },
          catalogueVersion: { increment: 1 },
        },
        select: { catalogueVersion: true, updatedAt: true },
      });

      const restoredSnapshot = await captureSnapshot(tx, productId);
      const created = await tx.productCatalogueVersion.create({
        data: {
          productId,
          version: product.catalogueVersion,
          source: 'RESTORE',
          summary: `Restored version ${versionNumber}`,
          snapshot: restoredSnapshot,
          ...actor(req),
        },
      });
      return { version: created.version, updatedAt: product.updatedAt.toISOString() };
    });

    audit(req, {
      action: 'product.catalogue.restored',
      entity: 'products',
      entityId: productId,
      changes: { restoredFrom: versionNumber, createdVersion: restored.version },
    });
    return restored;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw AppError.conflict(
          'A restored SKU, barcode, or slug is already used by another product',
        );
      }
      if (error.code === 'P2003' || error.code === 'P2025') {
        throw AppError.conflict(
          'This catalogue version references a category or tag that no longer exists',
        );
      }
    }
    throw error;
  }
}
