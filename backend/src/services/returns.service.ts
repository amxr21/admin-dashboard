import { randomInt } from 'node:crypto';
import {
  Prisma,
  ReturnCategory,
  ReturnItemStatus,
  ReturnResolution,
  ReturnStatus,
} from '@prisma/client';
import type { Request } from 'express';
import { resolveBranchLabels } from './branches.service.js';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { notify } from './notify.service.js';
import { getSettingValue } from './settings.service.js';
import { ASSIGNMENT_ON_ORDER_STATUS, canTransition } from '../config/orders.config.js';

import { defaultBranchId } from './inventory.service.js';
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

/**
 * The return-window check (B4.11) — a WARNING, never a gate. Days elapsed
 * since the order was PLACED, not since the return was requested: the
 * window is a promise about the purchase, not about how quickly someone
 * files the paperwork. `windowDays: 0` means no window at all.
 */
function returnWindowStatus(
  placedAt: Date,
  windowDays: number,
): { daysSincePurchase: number; withinWindow: boolean } {
  const daysSincePurchase = Math.floor(
    (Date.now() - placedAt.getTime()) / (24 * 60 * 60 * 1000),
  );

  return {
    daysSincePurchase,
    withinWindow: windowDays === 0 || daysSincePurchase <= windowDays,
  };
}

export interface ReturnListParams {
  page?: number;
  pageSize?: number;
  status?: ReturnStatus;
  /** Matches the RMA number or the order number. */
  search?: string;
  /**
   * Restrict to returns against orders taken at one branch (F8).
   *
   * A `Return` has no `branchId` of its own, deliberately: it carries a
   * required `orderId` and the order already records the branch. A second
   * copy could drift from the first the moment an order is corrected.
   */
  branchId?: string;
}

export async function listReturns(params: ReturnListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.ReturnWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.branchId ? { order: { branchId: params.branchId } } : {}),
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
        category: true,
        createdAt: true,
        // O1: reached THROUGH the order, because a return has no branch of
        // its own — it carries a required `orderId` and the order already
        // records the branch, so a second copy could only drift from it.
        order: { select: { id: true, orderNumber: true, branchId: true, placedAt: true } },
        customer: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.return.count({ where }),
  ]);

  const branches = await resolveBranchLabels(rows.map((row) => row.order.branchId));
  const windowDays = Number(await getSettingValue('returns.windowDays'));

  return {
    returns: rows.map((row) => ({
      id: row.id,
      rmaNumber: row.rmaNumber,
      status: row.status,
      resolution: row.resolution,
      category: row.category,
      createdAt: row.createdAt.toISOString(),
      order: { id: row.order.id, orderNumber: row.order.orderNumber },
      // A warning, not a gate (B4.11) — see `returnWindowStatus`'s own note.
      withinWindow: returnWindowStatus(row.order.placedAt, windowDays).withinWindow,
      customer: row.customer,
      branch: row.order.branchId ? (branches.get(row.order.branchId) ?? null) : null,
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
      category: true,
      status: true,
      resolution: true,
      refundAmount: true,
      restockingFeePercent: true,
      restocked: true,
      rejectionReason: true,
      createdAt: true,
      order: { select: { id: true, orderNumber: true, status: true, placedAt: true } },
      // Exchange (O9.8) — null until the replacement sale completes, a real
      // "started but not finished" state, not a gap to hide.
      exchangeOrder: { select: { id: true, orderNumber: true } },
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

  const windowDays = Number(await getSettingValue('returns.windowDays'));

  return {
    id: row.id,
    rmaNumber: row.rmaNumber,
    reason: row.reason,
    category: row.category,
    status: row.status,
    resolution: row.resolution,
    refundAmount: money(row.refundAmount),
    restockingFeePercent: row.restockingFeePercent?.toFixed(2) ?? null,
    restocked: row.restocked,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    order: { id: row.order.id, orderNumber: row.order.orderNumber, status: row.order.status },
    // A warning, not a gate (B4.11) — surfaced so the approving screen can
    // show "this is past the return window" without refusing anything.
    ...returnWindowStatus(row.order.placedAt, windowDays),
    exchangeOrder: row.exchangeOrder,
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
  category?: ReturnCategory;
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
        category: input.category,
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

/**
 * A decision on ONE line of a return (B4.7 / B4.8).
 *
 * Optional on the whole request: omitting `items` accepts every line in full,
 * which is exactly what approving a return has always done. Existing callers
 * therefore keep working unchanged, and nothing about past returns is
 * reinterpreted.
 */
export interface ReturnItemDecision {
  returnItemId: string;
  accepted: boolean;
  /**
   * How many to accept (B4.8). Omitted means "all of what was asked".
   *
   * Fewer is a real case — two of three arrived sellable — and it drives BOTH
   * the refund cap and the restock, so it cannot be a display-only note.
   */
  acceptedQuantity?: number | undefined;
  /** Required when `accepted` is false: the customer is owed a reason. */
  rejectionReason?: string | undefined;
}

export interface ApproveReturnInput {
  resolution: Exclude<ReturnResolution, 'NONE'>;
  /** Decimal string. Required when resolution is REFUND, ignored otherwise. */
  refundAmount?: string | undefined;
  restock: boolean;
  /**
   * Per-line decisions (B4.7). Omit to accept everything in full — the
   * behaviour this endpoint has always had.
   */
  items?: ReturnItemDecision[] | undefined;
  actorId: string;
  /** Which branch the stock comes back to (F8.2). */
  branchId?: string | undefined;
  /**
   * A restocking fee (B4.11), 0-100. Omit to use the store default
   * (`returns.restockingFeePercent`) — a default, not the whole answer: the
   * person approving may raise or waive it for this one return (a defect
   * gets 0%, "changed my mind" gets the full rate). Reduces the refund CAP,
   * never forces the refund amount itself — the operator still enters what
   * was actually paid back, same as before this existed.
   */
  restockingFeePercent?: number | undefined;
}

export async function approveReturn(id: string, input: ApproveReturnInput, req: Request) {
  if (input.resolution === ReturnResolution.REFUND && !input.refundAmount) {
    throw AppError.badRequest('Enter a refund amount', { field: 'refundAmount' });
  }

  // Declared outside the transaction so the audit call below can read what
  // was actually applied — the transaction only WRITES it.
  let appliedRestockingFeePercent: Prisma.Decimal | null = null;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.return.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        orderId: true,
        items: {
          select: {
            id: true,
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
      select: {
        id: true,
        status: true,
        branchId: true,
        assignment: { select: { id: true } },
      },
    });

    if (!order) throw AppError.notFound('Order not found');

    if (!canTransition(order.status, 'RETURNED')) {
      throw AppError.badRequest(
        `Cannot approve — the order is ${order.status.toLowerCase()}`,
        { field: 'status' },
      );
    }

    /**
     * Resolve every line to a decision (B4.7 / B4.8).
     *
     * With no `items` given, every line is accepted in full — what approving
     * a return has always meant, so existing callers are unchanged.
     */
    const byId = new Map((input.items ?? []).map((entry) => [entry.returnItemId, entry]));

    const unknown = [...byId.keys()].filter(
      (returnItemId) => !existing.items.some((item) => item.id === returnItemId),
    );

    if (unknown.length > 0) {
      // Refused rather than ignored: a decision aimed at the wrong line means
      // the operator was looking at a different return, and silently dropping
      // it would approve something they did not intend.
      throw AppError.badRequest('A decision names a line that is not on this return', {
        field: 'items',
      });
    }

    const decisions = existing.items.map((item) => {
      const decision = byId.get(item.id);

      if (!decision) {
        return { item, accepted: true, quantity: item.quantity, rejectionReason: null };
      }

      if (!decision.accepted) {
        if (!decision.rejectionReason?.trim()) {
          // The customer is owed a reason. "Some of your return was refused"
          // with no explanation is the complaint that follows.
          throw AppError.badRequest('Give a reason for each refused line', {
            field: 'rejectionReason',
          });
        }

        return {
          item,
          accepted: false,
          quantity: 0,
          rejectionReason: decision.rejectionReason.trim(),
        };
      }

      const quantity = decision.acceptedQuantity ?? item.quantity;

      if (!Number.isInteger(quantity) || quantity <= 0) {
        // Accepting zero is a REJECTION, and must carry a reason like one —
        // otherwise it is a rejection with no explanation wearing a different
        // name.
        throw AppError.badRequest('Accepted quantity must be a whole number above zero', {
          field: 'acceptedQuantity',
        });
      }

      if (quantity > item.quantity) {
        // Accepting more than was asked for would refund and restock stock
        // the customer never returned.
        throw AppError.badRequest(
          `Cannot accept ${String(quantity)} — only ${String(item.quantity)} were returned`,
          { field: 'acceptedQuantity' },
        );
      }

      return { item, accepted: true, quantity, rejectionReason: null };
    });

    if (decisions.every((decision) => !decision.accepted)) {
      // Nothing accepted is a REJECTION of the whole return, not an approval
      // of nothing — and it must not move the order to RETURNED.
      throw AppError.badRequest(
        'No lines were accepted — reject the return instead of approving it',
        { field: 'items' },
      );
    }

    let refundAmount: Prisma.Decimal | null = null;
    let restockingFeePercent: Prisma.Decimal | null = null;

    if (input.resolution === ReturnResolution.REFUND) {
      // A default the approving person may raise or waive per return
      // (B4.11) — never re-reads the store setting later, so a change to it
      // cannot silently rewrite what a past return actually charged.
      const feePercent =
        input.restockingFeePercent ?? Number(await getSettingValue('returns.restockingFeePercent'));

      if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
        throw AppError.badRequest('Restocking fee must be between 0 and 100', {
          field: 'restockingFeePercent',
        });
      }

      restockingFeePercent = new Prisma.Decimal(feePercent);

      // Capped to what was ACCEPTED, not what was asked (B4.8) — refunding
      // the full request after refusing a line would pay for goods the shop
      // never took back. Still the line-item price recorded AT THE TIME OF
      // ORDER, never a live product price. The fee then reduces the CAP —
      // the operator still enters what was actually paid back, same as
      // before this existed.
      const itemsValue = decisions.reduce(
        (sum, decision) =>
          sum.add(decision.item.orderItem.price.mul(decision.quantity)),
        new Prisma.Decimal(0),
      );
      const maxRefund = itemsValue
        .mul(new Prisma.Decimal(100).minus(restockingFeePercent))
        .dividedBy(100);
      const requested = new Prisma.Decimal(input.refundAmount as string);

      if (requested.isNegative() || requested.greaterThan(maxRefund)) {
        throw AppError.badRequest(
          `Refund cannot exceed ${maxRefund.toFixed(2)} — the value of the returned items${
            restockingFeePercent.greaterThan(0)
              ? ` minus a ${restockingFeePercent.toFixed(0)}% restocking fee`
              : ''
          }`,
          { field: 'refundAmount', max: maxRefund.toFixed(2) },
        );
      }

      refundAmount = requested;
      appliedRestockingFeePercent = restockingFeePercent;
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
      // Where the goods physically come back to. Falls back to the order's
      // own branch, then the default — restocking somewhere arbitrary is how
      // a branch ends up with stock it never received.
      const restockBranchId = input.branchId ?? order.branchId ?? (await defaultBranchId());

      for (const decision of decisions) {
        // A refused line goes back to the customer, so nothing is restocked.
        if (!decision.accepted) continue;

        // Hard-deleted product: nothing left to restock against.
        if (!decision.item.orderItem.productId) continue;

        const productId = decision.item.orderItem.productId;

        await tx.stockMovement.create({
          data: {
            productId,
            // ACCEPTED quantity, not requested (B4.8).
            delta: decision.quantity,
            reason: 'RETURNED',
            // Recorded against a branch (F8.2). Without it the movement log
            // and `BranchStock` stop agreeing with `Product.stock`, which is
            // exactly the invariant branch scoping depends on.
            branchId: restockBranchId,
            note: `Return ${id}`,
            actorId: input.actorId,
          },
        });

        await tx.branchStock.upsert({
          where: { productId_branchId: { productId, branchId: restockBranchId } },
          create: { productId, branchId: restockBranchId, quantity: decision.quantity },
          update: { quantity: { increment: decision.quantity } },
        });

        await tx.product.update({
          where: { id: productId },
          data: { stock: { increment: decision.quantity } },
        });
      }
    }

    // Record what was decided per line, so a partial approval is legible
    // afterwards rather than being inferable only from the refund total.
    for (const decision of decisions) {
      await tx.returnItem.update({
        where: { id: decision.item.id },
        data: {
          status: decision.accepted ? ReturnItemStatus.ACCEPTED : ReturnItemStatus.REJECTED,
          acceptedQuantity: decision.accepted ? decision.quantity : 0,
          rejectionReason: decision.rejectionReason,
        },
      });
    }

    await tx.return.update({
      where: { id },
      data: {
        status: ReturnStatus.APPROVED,
        resolution: input.resolution,
        refundAmount,
        restockingFeePercent,
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
      ...(appliedRestockingFeePercent !== null
        ? { restockingFeePercent: { to: (appliedRestockingFeePercent as Prisma.Decimal).toFixed(2) } }
        : {}),
    },
  });

  return serialiseReturn(id);
}

export async function rejectReturn(id: string, rejectionReason: string, req: Request) {
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

    await tx.return.update({
      where: { id },
      data: { status: ReturnStatus.REJECTED, rejectionReason },
    });
  });

  audit(req, {
    action: 'return.rejected',
    entity: 'return',
    entityId: id,
    changes: {
      status: { from: 'REQUESTED', to: 'REJECTED' },
      rejectionReason: { from: null, to: rejectionReason },
    },
  });

  return serialiseReturn(id);
}
