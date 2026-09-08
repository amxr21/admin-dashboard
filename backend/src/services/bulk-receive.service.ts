import { StockMovementReason } from '@prisma/client';
import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { adjustStock, defaultBranchId } from './inventory.service.js';

/**
 * Receiving a delivery of many products at once (F3.5).
 *
 * ─── WHY THIS IS NOT THE GENERIC IMPORT ──────────────────────────────
 * `resource.service.ts`'s import is create-only (`assertPermitted(config,
 * 'create')`) and writes rows of a CONFIGURED resource. Neither fits: a
 * delivery UPDATES stock the shop already has, and inventory is deliberately
 * not a configured resource — stock is an append-only movement log, never an
 * editable number, and exposing it to a generic field-merge would be exactly
 * the shape that rule exists to prevent.
 *
 * So this reuses the import's SHAPE — validate everything, then apply all or
 * nothing — rather than its code.
 *
 * ─── ALL OR NOTHING, LIKE THE IMPORT ─────────────────────────────────
 * A delivery is one event. Receiving "47 of 50 lines" leaves a shop whose
 * counted stock matches neither the paperwork nor the shelf, and the three
 * that failed are exactly the ones nobody will remember to chase. Refusing
 * all 50 with a per-line reason is the recoverable failure.
 */

/** The same ceiling the resource import uses — one number for "how much can
 *  arrive in one operation" across the app, not a different one per feature. */
export const RECEIVE_ROW_LIMIT = 1000;

export interface ReceiveLine {
  /** Matched by SKU or barcode — whichever the supplier's paperwork carries. */
  sku?: string | undefined;
  barcode?: string | undefined;
  quantity: number;
  unitCost?: string | undefined;
  note?: string | undefined;
}

export interface ReceiveBatch {
  branchId?: string | undefined;
  supplierId?: string | undefined;
  deliveredAt?: string | undefined;
  purchasedAt?: string | undefined;
  reference?: string | undefined;
  lines: ReceiveLine[];
}

export interface ReceiveLineError {
  /** 1-indexed over the submitted lines, so "line 3" is the third row the
   *  person typed — not an array index they never see. */
  line: number;
  message: string;
}

export interface ReceivePreview {
  totalLines: number;
  validLines: number;
  errors: ReceiveLineError[];
  /** What each valid line resolved to, so the UI can show the operator the
   *  product NAME before they commit — a SKU typo that happens to match a
   *  different real product is otherwise invisible until the stock is wrong. */
  resolved: { line: number; productId: string; name: string; quantity: number }[];
}

/**
 * Validate every line, write nothing.
 *
 * Shared by the preview endpoint AND apply — apply re-validates from scratch
 * rather than trusting a client-supplied "already checked" flag, because a
 * product can be archived in the gap between the two.
 */
export async function previewReceive(batch: ReceiveBatch): Promise<ReceivePreview> {
  if (batch.lines.length === 0) {
    throw AppError.badRequest('The delivery has no lines');
  }

  if (batch.lines.length > RECEIVE_ROW_LIMIT) {
    throw AppError.badRequest(`A delivery is capped at ${RECEIVE_ROW_LIMIT} lines`, {
      max: RECEIVE_ROW_LIMIT,
      received: batch.lines.length,
    });
  }

  if (batch.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: batch.supplierId },
      select: { id: true },
    });

    if (!supplier) throw AppError.badRequest('Supplier not found', { field: 'supplierId' });
  }

  // One query for every code in the file rather than one per line: a 500-line
  // delivery would otherwise be 500 round trips before anything is written.
  const skus = batch.lines.map((line) => line.sku).filter((v): v is string => Boolean(v));
  const barcodes = batch.lines.map((line) => line.barcode).filter((v): v is string => Boolean(v));

  const products =
    skus.length > 0 || barcodes.length > 0
      ? await prisma.product.findMany({
          where: { OR: [{ sku: { in: skus } }, { barcode: { in: barcodes } }] },
          select: { id: true, name: true, sku: true, barcode: true },
        })
      : [];

  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku!, p]));
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p]));

  const errors: ReceiveLineError[] = [];
  const resolved: ReceivePreview['resolved'] = [];
  /** Catches the same product listed twice — see the error message below. */
  const seen = new Map<string, number>();

  for (const [index, line] of batch.lines.entries()) {
    const lineNumber = index + 1;

    if (!line.sku && !line.barcode) {
      errors.push({ line: lineNumber, message: 'Give a SKU or a barcode to identify the product' });
      continue;
    }

    const product = (line.sku ? bySku.get(line.sku) : undefined) ?? (line.barcode ? byBarcode.get(line.barcode) : undefined);

    if (!product) {
      errors.push({
        line: lineNumber,
        message: `No product matches ${line.sku ?? line.barcode}`,
      });
      continue;
    }

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      // Receiving zero is not a delivery, and a negative is a write-off that
      // belongs on its own movement with its own reason.
      errors.push({ line: lineNumber, message: 'Quantity must be a whole number above zero' });
      continue;
    }

    const previous = seen.get(product.id);

    if (previous !== undefined) {
      // Refused rather than summed. Two lines for one product usually means a
      // duplicated row, and silently adding them doubles the stock with
      // nothing on screen to explain it. If a delivery genuinely arrives in
      // two cartons, that is two lines the operator should merge themselves.
      errors.push({
        line: lineNumber,
        message: `${product.name} is already on line ${previous} — combine them into one line`,
      });
      continue;
    }

    seen.set(product.id, lineNumber);
    resolved.push({
      line: lineNumber,
      productId: product.id,
      name: product.name,
      quantity: line.quantity,
    });
  }

  return {
    totalLines: batch.lines.length,
    validLines: resolved.length,
    errors,
    resolved,
  };
}

export interface ReceiveResult extends ReceivePreview {
  received: number;
}

/**
 * Apply the delivery.
 *
 * Each line goes through `adjustStock`, deliberately, rather than writing
 * `StockMovement` rows directly: that function is where the branch fallback,
 * the per-branch total, the product total and the low-stock notification all
 * live. Bypassing it to save a few queries is how the three stock numbers
 * F8.2 keeps in agreement start to drift.
 */
export async function applyReceive(
  batch: ReceiveBatch,
  actorId: string,
  req: Request,
): Promise<ReceiveResult> {
  const preview = await previewReceive(batch);

  if (preview.errors.length > 0) {
    // Same contract as the resource import: refuse the whole delivery rather
    // than receive the valid subset.
    return { ...preview, received: 0 };
  }

  const branchId = batch.branchId ?? (await defaultBranchId());

  for (const line of preview.resolved) {
    const source = batch.lines[line.line - 1]!;

    await adjustStock(
      line.productId,
      {
        delta: line.quantity,
        reason: StockMovementReason.RECEIVED,
        branchId,
        // The batch's own facts, repeated onto every line: a delivery note
        // covers all of them, and a movement that lost its supplier would
        // leave "where did this come from" unanswerable for that product
        // alone.
        supplierId: batch.supplierId,
        deliveredAt: batch.deliveredAt,
        purchasedAt: batch.purchasedAt,
        reference: batch.reference,
        unitCost: source.unitCost,
        note: source.note,
        actorId,
      },
      req,
    );
  }

  audit(req, {
    action: 'inventory.bulk_received',
    entity: 'inventory',
    entityId: batch.reference ?? branchId,
    changes: {
      lines: { from: null, to: preview.resolved.length },
      units: { from: null, to: preview.resolved.reduce((sum, l) => sum + l.quantity, 0) },
      reference: { from: null, to: batch.reference ?? null },
    },
  });

  return { ...preview, received: preview.resolved.length };
}

/**
 * Parse a supplier's CSV into lines.
 *
 * Deliberately forgiving about the header names — a supplier's export says
 * "Qty" or "Quantity" or "QTY", and rejecting a real delivery note over
 * capitalisation is friction with no safety value. The VALUES are still
 * validated strictly by `previewReceive`.
 */
export function parseReceiveCsv(rows: Record<string, string>[]): ReceiveLine[] {
  const pick = (row: Record<string, string>, ...names: string[]): string | undefined => {
    for (const [key, value] of Object.entries(row)) {
      const normalised = key.trim().toLowerCase().replace(/[\s_-]/g, '');
      if (names.includes(normalised) && value.trim() !== '') return value.trim();
    }
    return undefined;
  };

  return rows.map((row) => {
    const quantity = pick(row, 'qty', 'quantity', 'units', 'count');

    return {
      sku: pick(row, 'sku', 'code', 'productcode'),
      barcode: pick(row, 'barcode', 'ean', 'upc'),
      // NaN rather than 0 when unparseable: `previewReceive` rejects it with a
      // per-line message, where a silent 0 would look like a deliberate entry.
      quantity: quantity === undefined ? Number.NaN : Number(quantity),
      unitCost: pick(row, 'unitcost', 'cost', 'price'),
      note: pick(row, 'note', 'notes', 'comment'),
    };
  });
}
