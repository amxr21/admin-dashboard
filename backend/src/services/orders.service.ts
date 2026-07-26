import { OrderStatus, Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import {
  ASSIGNMENT_ON_ORDER_STATUS,
  canTransition,
  nextStatuses,
} from '../config/orders.config.js';

/**
 * Orders — the one resource the generic engine cannot express.
 *
 * Everything else in this app is a row you edit. An order is a row plus line
 * items plus an audit trail plus a courier assignment, and moving it forward
 * touches three tables at once. The engine has no vocabulary for "then", "if"
 * or "in a transaction", which is exactly why this file exists.
 *
 * ─── MONEY IS A STRING ON THE WIRE ───────────────────────────────────
 * Same rule as everywhere else: Decimal is serialised with toFixed(2) and
 * never becomes a JSON number, which would lose precision inside JSON.parse
 * before any client code could check it.
 *
 * ─── TOTALS ARE READ, NEVER RECOMPUTED ───────────────────────────────
 * `order.total` and `orderItem.price` are denormalised on purpose. Recomputing
 * a historical total from current product prices would silently rewrite what a
 * customer was charged the moment someone edits a price.
 */

/** Page size ceiling. Without one, `?pageSize=100000` is a scraping tool. */
const MAX_PAGE_SIZE = 100;

function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** Inclusive ISO dates filtering on `placedAt`. */
  from?: string;
  to?: string;
  /** Matches order number, customer name or customer email. */
  search?: string;
}

function buildWhere(params: OrderListParams): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  if (params.status) where.status = params.status;

  if (params.from || params.to) {
    where.placedAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      // The caller means the whole of the end day, not midnight at its start.
      ...(params.to ? { lte: new Date(`${params.to.slice(0, 10)}T23:59:59.999Z`) } : {}),
    };
  }

  if (params.search) {
    const contains = params.search;
    where.OR = [
      { orderNumber: { contains } },
      { customer: { name: { contains } } },
      { customer: { email: { contains } } },
    ];
  }

  return where;
}

export async function listOrders(params: OrderListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const where = buildWhere(params);

  // One transaction so the count cannot disagree with the page it describes.
  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        placedAt: true,
        paymentMethod: true,
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      total: money(row.total),
      placedAt: row.placedAt.toISOString(),
      paymentMethod: row.paymentMethod,
      customer: row.customer,
      itemCount: row._count.items,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      paymentMethod: true,
      placedAt: true,
      customer: {
        select: { id: true, name: true, email: true, phone: true, city: true, country: true },
      },
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          quantity: true,
          price: true,
          productId: true,
          product: { select: { id: true, name: true, sku: true, imageUrl: true } },
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          changedById: true,
          createdAt: true,
        },
      },
      assignment: {
        select: {
          id: true,
          status: true,
          address: true,
          city: true,
          driver: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });

  if (!order) throw AppError.notFound('Order not found');

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: money(order.total),
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt.toISOString(),
    customer: order.customer,
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      // The price the customer actually paid, not today's price.
      price: money(item.price),
      lineTotal: item.price.mul(item.quantity).toFixed(2),
      productId: item.productId,
      // Null when the product was hard-deleted. Line items carry a price
      // snapshot but NOT a name snapshot, so there is nothing to fall back to
      // and the UI has to say so rather than render a blank row.
      product: item.product,
    })),
    statusHistory: order.statusHistory.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    assignment: order.assignment,
    /** Only the moves the server would actually accept from here. */
    nextStatuses: nextStatuses(order.status),
  };
}

export interface ChangeStatusInput {
  to: OrderStatus;
  note?: string | undefined;
  actorId: string;
}

/**
 * Move an order to a new status.
 *
 * ─── WHY ONE TRANSACTION IS NOT OPTIONAL ─────────────────────────────
 * Three writes have to agree: the order's status, the audit row saying who
 * moved it, and the courier's assignment. If the status write lands and the
 * audit write fails, the order is marked shipped with no record of who shipped
 * it — the exact question an audit trail exists to answer, now unanswerable.
 * Interactive transactions roll all three back together.
 */
export async function changeOrderStatus(id: string, input: ChangeStatusInput) {
  const current = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, assignment: { select: { id: true } } },
  });

  if (!current) throw AppError.notFound('Order not found');

  if (current.status === input.to) {
    throw AppError.badRequest(`This order is already ${input.to.toLowerCase()}`, {
      field: 'to',
    });
  }

  if (!canTransition(current.status, input.to)) {
    // Names the legal moves rather than just refusing — a bare "invalid
    // transition" leaves the caller guessing what would have worked.
    throw AppError.badRequest(
      `Cannot move an order from ${current.status} to ${input.to}`,
      { field: 'to', allowed: nextStatuses(current.status) },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: input.to } });

    await tx.orderStatusHistory.create({
      data: {
        orderId: id,
        fromStatus: current.status,
        toStatus: input.to,
        note: input.note ?? null,
        // Plain id, not a relation: the trail must survive the staff member
        // being deleted.
        changedById: input.actorId,
      },
    });

    const assignmentStatus = ASSIGNMENT_ON_ORDER_STATUS[input.to];

    if (current.assignment && assignmentStatus) {
      await tx.deliveryAssignment.update({
        where: { id: current.assignment.id },
        data: { status: assignmentStatus },
      });
    }
  });

  return getOrder(id);
}
