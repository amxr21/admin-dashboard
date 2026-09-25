import { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import type { CsvColumn } from '../lib/csv.js';
import { audit } from './audit.service.js';

/**
 * Variant CSV export and import.
 *
 * Variants are not a generic resource (their stock is a movement log, and they
 * only exist under a product), so they get their own file shape rather than a
 * row in the resource engine. The CONTRACT is the engine's, deliberately: a
 * dry run returns `{ totalRows, validRows, errors }`, and a commit is
 * all-or-nothing in one transaction — so the same import sheet drives both.
 *
 * Stock is exported but never imported. Stock changes are movements with a
 * reason; a spreadsheet overwriting counts would bypass exactly that log.
 */

const IMPORT_ROW_LIMIT = 2000;
const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export const VARIANT_IMPORT_COLUMNS = [
  'Product SKU',
  'Variant name',
  'Variant SKU',
  'Barcode',
  'Price',
] as const;

export interface VariantExportRow {
  productSku: string;
  productName: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  stock: number;
}

export const VARIANT_EXPORT_COLUMNS: readonly CsvColumn<VariantExportRow>[] = [
  { header: 'Product SKU', value: (row) => row.productSku },
  { header: 'Product name', value: (row) => row.productName },
  { header: 'Variant name', value: (row) => row.name },
  { header: 'Variant SKU', value: (row) => row.sku },
  { header: 'Barcode', value: (row) => row.barcode },
  { header: 'Price', value: (row) => row.price },
  { header: 'Stock', value: (row) => row.stock },
];

/** Every variant, with stock at the active branch when one is selected. */
export async function listVariantsForExport(branchId?: string): Promise<VariantExportRow[]> {
  const variants = await prisma.productVariant.findMany({
    orderBy: [{ product: { name: 'asc' } }, { createdAt: 'asc' }],
    take: 10_000,
    select: {
      name: true,
      sku: true,
      barcode: true,
      price: true,
      stock: true,
      product: { select: { name: true, sku: true } },
      branchStock: {
        where: { branchId: branchId ?? '__business_wide__' },
        select: { quantity: true },
        take: 1,
      },
    },
  });

  return variants.map((variant) => ({
    productSku: variant.product.sku ?? '',
    productName: variant.product.name,
    name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode ?? '',
    price: variant.price.toFixed(2),
    stock: branchId ? (variant.branchStock[0]?.quantity ?? 0) : variant.stock,
  }));
}

export interface ImportRowError {
  row: number;
  field: string | null;
  message: string;
}

interface ValidRow {
  row: number;
  productId: string;
  existingId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  price: Prisma.Decimal;
}

function cell(row: Record<string, string>, header: string): string {
  return (row[header] ?? '').trim();
}

async function validateRows(rows: Record<string, string>[]) {
  if (rows.length === 0) throw AppError.badRequest('The file has no data rows');
  if (rows.length > IMPORT_ROW_LIMIT) {
    throw AppError.badRequest(`Import is capped at ${IMPORT_ROW_LIMIT} rows per file`, {
      max: IMPORT_ROW_LIMIT,
      received: rows.length,
    });
  }

  const productSkus = [...new Set(rows.map((row) => cell(row, 'Product SKU')).filter(Boolean))];
  const codes = [
    ...new Set(rows.flatMap((row) => [cell(row, 'Variant SKU'), cell(row, 'Barcode')]).filter(Boolean)),
  ];

  // Three reads for the whole file rather than several per row.
  const [products, variantsByCode, productsByCode] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: productSkus } }, select: { id: true, sku: true } }),
    prisma.productVariant.findMany({
      where: { OR: [{ sku: { in: codes } }, { barcode: { in: codes } }] },
      select: { id: true, sku: true, barcode: true, productId: true },
    }),
    prisma.product.findMany({
      where: { OR: [{ sku: { in: codes } }, { barcode: { in: codes } }] },
      select: { sku: true, barcode: true },
    }),
  ]);

  const productIdBySku = new Map(products.map((product) => [product.sku, product.id]));
  const variantBySku = new Map(variantsByCode.map((variant) => [variant.sku, variant]));
  const productCodes = new Set(productsByCode.flatMap((product) => [product.sku, product.barcode]).filter(Boolean));

  const errors: ImportRowError[] = [];
  const valid: ValidRow[] = [];
  const seenCodes = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    // Same numbering as the resource import: 1-based, counting the header.
    const rowNumber = index + 2;
    const fail = (field: string | null, message: string) => errors.push({ row: rowNumber, field, message });

    const productSku = cell(row, 'Product SKU');
    const name = cell(row, 'Variant name');
    const sku = cell(row, 'Variant SKU');
    const barcode = cell(row, 'Barcode') || null;
    const price = cell(row, 'Price');
    const before = errors.length;

    const productId = productIdBySku.get(productSku);
    if (!productSku) fail('Product SKU', 'Product SKU is required');
    else if (!productId) fail('Product SKU', `No product has the SKU ${productSku}`);

    if (!name) fail('Variant name', 'Variant name is required');
    else if (name.length > 120) fail('Variant name', 'Variant name is longer than 120 characters');

    if (!sku) fail('Variant SKU', 'Variant SKU is required');
    else if (sku.length > 64) fail('Variant SKU', 'Variant SKU is longer than 64 characters');

    if (barcode && barcode.length > 64) fail('Barcode', 'Barcode is longer than 64 characters');

    if (!MONEY_PATTERN.test(price)) fail('Price', 'Enter a price with up to 2 decimal places');

    const existing = sku ? variantBySku.get(sku) : undefined;
    if (existing && productId && existing.productId !== productId) {
      fail('Variant SKU', `The SKU ${sku} already belongs to a variant of another product`);
    }

    for (const [field, code] of [['Variant SKU', sku], ['Barcode', barcode]] as const) {
      if (!code) continue;

      const firstRow = seenCodes.get(code);
      if (firstRow !== undefined) {
        fail(field, `The code ${code} is also used on row ${String(firstRow)}`);
        continue;
      }
      seenCodes.set(code, rowNumber);

      if (productCodes.has(code)) {
        fail(field, `The code ${code} is already used by a product`);
        continue;
      }

      // Another variant carrying this code, other than the one this row updates.
      const clash = variantsByCode.find(
        (variant) => (variant.sku === code || variant.barcode === code) && variant.id !== existing?.id,
      );
      if (clash) fail(field, `The code ${code} is already used by another variant`);
    }

    if (errors.length === before && productId) {
      valid.push({
        row: rowNumber,
        productId,
        existingId: existing?.id ?? null,
        name,
        sku,
        barcode,
        price: new Prisma.Decimal(price),
      });
    }
  }

  return { errors, valid };
}

export async function previewVariantImport(rows: Record<string, string>[]) {
  const { errors, valid } = await validateRows(rows);
  return { totalRows: rows.length, validRows: valid.length, errors };
}

/** All rows in one transaction, and only when every row is valid. */
export async function applyVariantImport(rows: Record<string, string>[], req: Request) {
  const { errors, valid } = await validateRows(rows);

  if (errors.length > 0) {
    return { totalRows: rows.length, validRows: valid.length, errors, imported: 0 };
  }

  const written = await prisma.$transaction(async (tx) => {
    const results: { id: string; action: 'variant.create' | 'variant.update' }[] = [];

    for (const row of valid) {
      const data = { name: row.name, sku: row.sku, barcode: row.barcode, price: row.price };

      if (row.existingId) {
        await tx.productVariant.update({ where: { id: row.existingId }, data });
        results.push({ id: row.existingId, action: 'variant.update' });
      } else {
        const created = await tx.productVariant.create({
          data: { ...data, productId: row.productId },
          select: { id: true },
        });
        results.push({ id: created.id, action: 'variant.create' });
      }
    }

    return results;
  });

  // After the commit, so a rolled-back import leaves no audit trail behind.
  for (const entry of written) {
    audit(req, {
      action: entry.action,
      entity: 'product_variants',
      entityId: entry.id,
      changes: { source: { to: 'import' } },
    });
  }

  return { totalRows: rows.length, validRows: valid.length, errors: [], imported: written.length };
}
