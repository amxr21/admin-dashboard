import type { Request } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit, diff } from './audit.service.js';
import { sendEmailToRecipients } from './email.service.js';
import { getSettingValue } from './settings.service.js';

const MAX_PAGE_SIZE = 100;

export interface SupplierInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  note?: string | null;
  isActive?: boolean;
}

export async function listSuppliers(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  active?: boolean;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.SupplierWhereInput = {
    ...(params.active === undefined ? {} : { isActive: params.active }),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search } },
            { email: { contains: params.search } },
            { phone: { contains: params.search } },
            { contactName: { contains: params.search } },
          ],
        }
      : {}),
  };

  const [suppliers, total] = await prisma.$transaction([
    prisma.supplier.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  const receipts = suppliers.length
    ? await prisma.stockMovement.findMany({
        where: { supplierId: { in: suppliers.map((supplier) => supplier.id) }, delta: { gt: 0 } },
        select: { supplierId: true, productId: true, deliveredAt: true, createdAt: true },
        orderBy: [{ deliveredAt: 'desc' }, { createdAt: 'desc' }],
      })
    : [];

  return {
    suppliers: suppliers.map((supplier) => {
      const ownReceipts = receipts.filter((receipt) => receipt.supplierId === supplier.id);
      return {
        ...supplier,
        receiptCount: ownReceipts.length,
        productCount: new Set(ownReceipts.map((receipt) => receipt.productId)).size,
        lastReceivedAt:
          ownReceipts[0]?.deliveredAt?.toISOString() ?? ownReceipts[0]?.createdAt.toISOString() ?? null,
        createdAt: supplier.createdAt.toISOString(),
        updatedAt: supplier.updatedAt.toISOString(),
      };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function createSupplier(input: SupplierInput, req: Request) {
  const supplier = await prisma.supplier.create({ data: input });
  audit(req, {
    action: 'supplier.created',
    entity: 'suppliers',
    entityId: supplier.id,
    changes: diff({}, supplier),
  });
  return supplier;
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>, req: Request) {
  const before = await prisma.supplier.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Supplier not found');
  const supplier = await prisma.supplier.update({ where: { id }, data: input });
  const changes = diff(before, supplier);
  if (Object.keys(changes).length > 0) {
    audit(req, { action: 'supplier.updated', entity: 'suppliers', entityId: id, changes });
  }
  return supplier;
}

/** Suppliers are derived from receipts, never copied onto Product. */
export async function listProductSuppliers(productId: string, branchId?: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!product) throw AppError.notFound('Product not found');

  const receipts = await prisma.stockMovement.findMany({
    where: {
      productId,
      supplierId: { not: null },
      delta: { gt: 0 },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      deliveredAt: true,
      createdAt: true,
      supplier: { select: { id: true, name: true, email: true, phone: true, contactName: true, isActive: true } },
    },
    orderBy: [{ deliveredAt: 'desc' }, { createdAt: 'desc' }],
  });

  const seen = new Set<string>();
  const suppliers = receipts.flatMap((receipt) => {
    if (!receipt.supplier || seen.has(receipt.supplier.id)) return [];
    seen.add(receipt.supplier.id);
    return [{
      ...receipt.supplier,
      lastReceivedAt: receipt.deliveredAt?.toISOString() ?? receipt.createdAt.toISOString(),
    }];
  });
  return { product, suppliers };
}

export async function sendSupplierOutreach(input: {
  productId: string;
  supplierId: string;
  branchId?: string;
  subject: string;
  message: string;
}, req: Request) {
  const context = await listProductSuppliers(input.productId, input.branchId);
  const supplier = context.suppliers.find((candidate) => candidate.id === input.supplierId);
  if (!supplier) {
    throw AppError.badRequest('This supplier has no receiving history for this product at the selected branch', { field: 'supplierId' });
  }
  if (!supplier.isActive) throw AppError.badRequest('This supplier is inactive', { field: 'supplierId' });
  if (!supplier.email) throw AppError.badRequest('This supplier has no email address', { field: 'supplierId' });

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { stock: true, lowStockThreshold: true },
  });
  const threshold = product?.lowStockThreshold ?? Number(await getSettingValue('inventory.lowStockThreshold'));
  if (!product || product.stock > threshold) {
    throw AppError.conflict('This product is no longer low in stock');
  }

  const sent = await sendEmailToRecipients([supplier.email], input.subject, input.message);
  if (!sent) {
    throw AppError.serviceUnavailable('Email could not be sent. Check the outgoing email settings and try again.');
  }

  audit(req, {
    action: 'supplier.outreach.sent',
    entity: 'suppliers',
    entityId: supplier.id,
    changes: { productId: input.productId, recipient: supplier.email, subject: input.subject },
  });
  return { sent: true, supplier: { id: supplier.id, name: supplier.name, email: supplier.email } };
}
