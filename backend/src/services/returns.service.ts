import { randomInt } from 'node:crypto';
import { Prisma, ReturnResolution, ReturnStatus } from '@prisma/client';
import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { notify } from './notify.service.js';
import { getSettingValue } from './settings.service.js';
import { ASSIGNMENT_ON_ORDER_STATUS, canTransition } from '../config/orders.config.js';

/**
 * Returns / RMA — the one thing the resource engine cannot express, for the
 * same reason orders is bespoke: approving a return is a PROCEDURE (validate
 * the order can legally move to RETURNED, optionally restock, record a
 * resolution), not a row you edit.
 *
 * ─── ONE APPROVED RETURN PER ORDER, BY DESIGN ────────────────────────
 * `Order.status` already has a RETURNED value, set by this same transition
 * table `changeOrderStatus` uses. Approving a return moves the order there
 * rather than inventing a SECOND, disconnected notion of "returned" — two
 * sources of truth for the same fact is worse than the alternative, which is
 * that once an order is RETURNED (`ORDER_TRANSITIONS[RETURNED] = []`), a
 * further return against it cannot be separately approved. A business
 * needing itemised partial multi-round returns is out of scope here.
 *
 * ─── RESTOCKING REUSES THE EXISTING MOVEMENT LOG ─────────────────────
 * A restocked return writes a `StockMovement` with reason RETURNED — the
 * same append-only log inventory already uses — rather than a second stock
 * log that would need reconciling against the first.
 */

const MAX_PAGE_SIZE = 100;

/// No 0/O/1/I/L — read aloud on a support call the same reason courier codes
/// avoid them.
const RMA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRmaNumber(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += RMA_ALPHABET[randomInt(RMA_ALPHABET.length)];
  }
  return `RMA-${code}`;
}

function money(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}

export interface ReturnListParams {
  page?: number;
  pageSize?: number;
  status?: ReturnStatus;
  /** Matches the RMA number or the order number. */
  search?: string;
}

export async function listReturns(params: ReturnListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.ReturnWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.search
      ? {
          OR: [
            { rmaNumber: { contains: params.search } },
            { order: { orderNumber: { contains: params.search } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.return.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rmaNumber: true,
        status: true,
        resolution: true,
        createdAt: true,
        order: { select: { id: true, orderNumber: true } },
        customer: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.return.count({ where }),
  ]);

  return {
    returns: rows.map((row) => ({
      id: row.id,
      rmaNumber: row.rmaNumber,
      status: row.status,
      resolution: row.resolution,
      createdAt: row.createdAt.toISOString(),
      order: row.order,
      customer: row.customer,
      itemCount: row._count.items,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function serialiseReturn(id: string) {
  const row = await prisma.return.findUnique({
    where: { id },
    select: {
      id: true,
      rmaNumber: true,
      reason: true,
      status: true,
      resolution: true,
      refundAmount: true,
      restocked: true,
      createdAt: true,
      order: { select: { id: true, orderNumber: true, status: true } },
      customer: { select: { id: true, name: true, email: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          orderItem: {
            select: {
              id: true,
              price: true,
              productId: true,
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      },
    },
  });

  if (!row) throw AppError.notFound('Return not found');

  return {
    id: row.id,
    rmaNumber: row.rmaNumber,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    refundAmount: money(row.refundAmount),
    restocked: row.restocked,
    createdAt: row.createdAt.toISOString(),
    order: row.order,
    customer: row.customer,
    items: row.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      orderItemId: item.orderItem.id,
      price: money(item.orderItem.price),
      lineTotal: item.orderItem.price.mul(item.quantity).toFixed(2),
      // Null when the product was hard-deleted — same honesty as the order
      // detail page, never a blank row pretending nothing happened.
      product: item.orderItem.product,
    })),
  };
}

export async function getReturn(id: string) {
  return serialiseReturn(id);
}

export interface CreateReturnInput {
  orderId: string;
  reason: string;
  items: { orderItemId: string; quantity: number }[];
}

export async function createReturn(input: CreateReturnInput) {
  if (input.items.length === 0) {
    throw AppError.badRequest('Select at least one item to return', { field: 'items' });
  }

  const id = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        customerId: true,
        items: { select: { id: true, quantity: true } },
      },
    });

    if (!order) throw AppError.notFound('Order not found');

    // Only an order that could legally move to RETURNED is eligible — the
    // same gate `approveReturn` re-checks at approval time, since the order
    // may move on between request and approval.
    if (!canTransition(order.status, 'RETURNED')) {
      throw AppError.badRequest(
        `An order that is ${order.status.toLowerCase()} cannot have a return requested against it`,
        { field: 'orderId' },
      );
    }

    const orderItemById = new Map(order.items.map((item) => [item.id, item]));

    // Sum quantities already tied up in a non-rejected return for this order,
    // so a second RMA cannot ask for more than what remains.
    const existingReturnItems = await tx.returnItem.findMany({
      where: {
        orderItem: { orderId: input.orderId },
        return: { status: { not: ReturnStatus.REJECTED } },
      },
      select: { orderItemId: true, quantity: true },
    });

    const alreadyRequested = new Map<string, number>();
    for (const existing of existingReturnItems) {
      alreadyRequested.set(
        existing.orderItemId,
        (alreadyRequested.get(existing.orderItemId) ?? 0) + existing.quantity,
      );
    }

    for (const { orderItemId, quantity } of input.items) {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw AppError.badRequest('Quantity must be a positive whole number', {
          field: 'items',
        });
      }

      const orderItem = orderItemById.get(orderItemId);

      if (!orderItem) {
        throw AppError.badRequest('That item does not belong to this order', {
          field: 'items',
        });
      }

      const already = alreadyRequested.get(orderItemId) ?? 0;
      const remaining = orderItem.quantity - already;

      if (quantity > remaining) {
        throw AppError.badRequest(
          `Only ${String(remaining)} of this item can still be returned`,
          { field: 'items', available: remaining },
        );
      }
    }

    const created = await tx.return.create({
      data: {
        rmaNumber: generateRmaNumber(),
        reason: input.reason,
        orderId: input.orderId,
        customerId: order.customerId,
        items: {
          create: input.items.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
          })),
        },
      },
      select: { id: true },
    });

    return created.id;
  });

  const created = await serialiseReturn(id);

  if (await getSettingValue('notifications.returnRequestAlerts')) {
    notify({
      type: 'return.requested',
      title: `Return requested — ${created.rmaNumber}`,
      body: input.reason,
      link: '/admin/returns',
    });
  }

  return created;
}

export interface ApproveReturnInput {
  resolution: Exclude<ReturnResolution, 'NONE'>;
  /** Decimal string. Required when resolution is REFUND, ignored otherwise. */
  refundAmount?: string | undefined;
  restock: boolean;
  actorId: string;
}

export async function approveReturn(id: string, input: ApproveReturnInput, req: Request) {
  if (input.resolution === ReturnResolution.REFUND && !input.refundAmount) {
    throw AppError.badRequest('Enter a refund amount', { field: 'refundAmount' });
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.return.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        orderId: true,
        items: {
          select: {
            quantity: true,
            orderItem: { select: { productId: true, price: true } },
          },
        },
      },
    });

    if (!existing) throw AppError.notFound('Return not found');

    if (existing.status !== ReturnStatus.REQUESTED) {
      throw AppError.badRequest(
        `This return is already ${existing.status.toLowerCase()}`,
        { field: 'status' },
      );
    }

    const order = await tx.order.findUnique({
      where: { id: existing.orderId },
      select: { id: true, status: true, assignment: { select: { id: true } } },
    });

    if (!order) throw AppError.notFound('Order not found');

    if (!canTransition(order.status, 'RETURNED')) {
      throw AppError.badRequest(
        `Cannot approve — the order is ${order.status.toLowerCase()}`,
        { field: 'status' },
      );
    }

    let refundAmount: Prisma.Decimal | null = null;

    if (input.resolution === ReturnResolution.REFUND) {
      // Capped to what was actually purchased — the line-item price recorded
      // AT THE TIME OF ORDER, never a live product price.
      const maxRefund = existing.items.reduce(
        (sum, item) => sum.add(item.orderItem.price.mul(item.quantity)),
        new Prisma.Decimal(0),
      );
      const requested = new Prisma.Decimal(input.refundAmount as string);

      if (requested.isNegative() || requested.greaterThan(maxRefund)) {
        throw AppError.badRequest(
          `Refund cannot exceed ${maxRefund.toFixed(2)} — the value of the returned items`,
          { field: 'refundAmount', max: maxRefund.toFixed(2) },
        );
      }

      refundAmount = requested;
    }

    // Same three-write shape as changeOrderStatus: status, history, assignment
    // — all inside the one transaction that also settles the return itself.
    await tx.order.update({ where: { id: order.id }, data: { status: 'RETURNED' } });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'RETURNED',
        note: `Return ${id} approved`,
        changedById: input.actorId,
      },
    });

    const assignmentStatus = ASSIGNMENT_ON_ORDER_STATUS.RETURNED;

    if (order.assignment && assignmentStatus) {
      await tx.deliveryAssignment.update({
        where: { id: order.assignment.id },
        data: { status: assignmentStatus },
      });
    }

    if (input.restock) {
      for (const item of existing.items) {
        // Hard-deleted product: nothing left to restock against.
        if (!item.orderItem.productId) continue;

        await tx.stockMovement.create({
          data: {
            productId: item.orderItem.productId,
            delta: item.quantity,
            reason: 'RETURNED',
            note: `Return ${id}`,
            actorId: input.actorId,
          },
        });

        await tx.product.update({
          where: { id: item.orderItem.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }

    await tx.return.update({
      where: { id },
      data: {
        status: ReturnStatus.APPROVED,
        resolution: input.resolution,
        refundAmount,
        restocked: input.restock,
      },
    });
  });

  audit(req, {
    action: 'return.approved',
    entity: 'return',
    entityId: id,
    changes: {
      status: { from: 'REQUESTED', to: 'APPROVED' },
      resolution: { to: input.resolution },
      restocked: { to: input.restock },
    },
  });

  return serialiseReturn(id);
}

export async function rejectReturn(id: string, req: Request) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.return.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existing) throw AppError.notFound('Return not found');

    if (existing.status !== ReturnStatus.REQUESTED) {
      throw AppError.badRequest(
        `This return is already ${existing.status.toLowerCase()}`,
        { field: 'status' },
      );
    }

    await tx.return.update({ where: { id }, data: { status: ReturnStatus.REJECTED } });
  });

  audit(req, {
    action: 'return.rejected',
    entity: 'return',
    entityId: id,
    changes: { status: { from: 'REQUESTED', to: 'REJECTED' } },
  });

  return serialiseReturn(id);
}
