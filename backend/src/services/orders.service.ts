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

/** Columns selected directly on `Order` — never a `_count` or a relation
 *  field, neither of which a flat Prisma `orderBy` can sort by. */
export type OrderSortField = 'orderNumber' | 'placedAt' | 'total' | 'status';

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** Inclusive ISO dates filtering on `placedAt`. */
  from?: string;
  to?: string;
  /** Matches order number, customer name or customer email. */
  search?: string;
  sort?: OrderSortField;
  dir?: 'asc' | 'desc';
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

/** Defaults to newest-first, unchanged from before sort existed — a hand-typed
 *  or stale `?sort=` naming anything outside `OrderSortField` was already
 *  rejected as a 400 by the route's Zod enum before reaching here. */
function buildOrderBy(params: OrderListParams): Prisma.OrderOrderByWithRelationInput {
  if (!params.sort) return { placedAt: 'desc' };
  return { [params.sort]: params.dir === 'asc' ? 'asc' : 'desc' };
}

export async function listOrders(params: OrderListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const where = buildWhere(params);

  // One transaction so the count cannot disagree with the page it describes.
  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: buildOrderBy(params),
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

/** Same cap and truncation convention as the resource engine's own export
 *  (`RESOURCE_EXPORT_LIMIT` in resource.service.ts) and the audit trail's CSV
 *  export — one number for "how much can leave the system in one file"
 *  across the whole app, not a different ceiling per feature. */
export const ORDER_EXPORT_LIMIT = 10_000;

export interface OrderExportResult {
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    total: string | null;
    placedAt: string;
    paymentMethod: string | null;
    customerName: string | null;
    customerEmail: string | null;
    itemCount: number;
  }[];
  truncated: boolean;
}

/**
 * All orders matching the same search/filter/sort a list view would use, for
 * CSV export — same `buildWhere`/`buildOrderBy` as `listOrders`, just without
 * pagination. Reusing both means an export can never see a row the list view
 * itself couldn't already reach, and can never be sorted differently than
 * what the export button was clicked while looking at.
 */
export async function listOrdersForExport(
  params: Pick<OrderListParams, 'status' | 'from' | 'to' | 'search' | 'sort' | 'dir'>,
): Promise<OrderExportResult> {
  const where = buildWhere(params);

  const rows = await prisma.order.findMany({
    where,
    orderBy: buildOrderBy(params),
    take: ORDER_EXPORT_LIMIT + 1,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      placedAt: true,
      paymentMethod: true,
      customer: { select: { name: true, email: true } },
      _count: { select: { items: true } },
    },
  });

  const truncated = rows.length > ORDER_EXPORT_LIMIT;
  const page = truncated ? rows.slice(0, ORDER_EXPORT_LIMIT) : rows;

  return {
    orders: page.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      total: money(row.total),
      placedAt: row.placedAt.toISOString(),
      paymentMethod: row.paymentMethod,
      customerName: row.customer?.name ?? null,
      customerEmail: row.customer?.email ?? null,
      itemCount: row._count.items,
    })),
    truncated,
  };
}

export interface OrderNeighbor {
  id: string;
  orderNumber: string;
}

/**
 * The order immediately before/after `id` in the same filtered, sorted list
 * a staff member was looking at when they clicked in — reuses `buildWhere`/
 * `buildOrderBy` so this can never disagree with what the list view itself
 * would show. Capped at `ORDER_EXPORT_LIMIT` for the same reason CSV export
 * is: beyond that this degrades to "no neighbor" rather than an unbounded
 * scan, and a list that large is not one anyone is paging through by hand.
 */
export async function getOrderNeighbors(
  id: string,
  params: Pick<OrderListParams, 'status' | 'from' | 'to' | 'search' | 'sort' | 'dir'>,
): Promise<{ prev: OrderNeighbor | null; next: OrderNeighbor | null }> {
  const where = buildWhere(params);

  const rows = await prisma.order.findMany({
    where,
    orderBy: buildOrderBy(params),
    take: ORDER_EXPORT_LIMIT,
    select: { id: true, orderNumber: true },
  });

  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return { prev: null, next: null };

  return {
    prev: index > 0 ? (rows[index - 1] ?? null) : null,
    next: index < rows.length - 1 ? (rows[index + 1] ?? null) : null,
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
      subtotal: true,
      taxAmount: true,
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
      notes: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, authorId: true, createdAt: true },
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
          attemptCount: true,
          failureReason: true,
          driver: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });

  if (!order) throw AppError.notFound('Order not found');

  // One lookup for every staff name this response needs — status-history
  // actors AND note authors both resolve through the same "id survives,
  // relation doesn't" pattern (see OrderNote's own doc comment).
  const staffIds = [
    ...new Set(
      [
        ...order.statusHistory.map((entry) => entry.changedById),
        ...order.notes.map((note) => note.authorId),
      ].filter((v) => v !== null),
    ),
  ];
  const staffUsers = staffIds.length
    ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
    : [];
  const changedByNames = new Map(staffUsers.map((u) => [u.id, u.name]));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: money(order.total),
    subtotal: money(order.subtotal),
    taxAmount: money(order.taxAmount),
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt.toISOString(),
    notes: order.notes.map((note) => ({
      id: note.id,
      body: note.body,
      authorId: note.authorId,
      authorName: changedByNames.get(note.authorId ?? '') ?? null,
      createdAt: note.createdAt.toISOString(),
    })),
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
      // Resolved separately, not via a Prisma relation — `changedById` is
      // deliberately a plain id (see schema.prisma), so the history survives
      // the staff member being deleted. Null there or here both mean the
      // same thing: no name to show.
      changedByName: changedByNames.get(entry.changedById ?? '') ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
    assignment: order.assignment,
    /** Only the moves the server would actually accept from here. */
    nextStatuses: nextStatuses(order.status),
  };
}

export type TimelineEventKind =
  | 'status'
  | 'note'
  | 'delivery'
  | 'return'
  | 'other';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  /** e.g. "order.status.changed", "return.approved" — same vocabulary as `AuditLog.action`/`OrderStatusHistory`. */
  action: string;
  actorName: string | null;
  createdAt: string;
  /** Free-form, rendered as-is by the UI — shape differs per kind. */
  detail: Record<string, unknown>;
}

/**
 * C5.4 — every real event touching this order, chronologically merged.
 *
 * ─── WHY FOUR QUERIES, NOT ONE ────────────────────────────────────────
 * There is no single table this could read from. Status moves live in
 * `OrderStatusHistory` (their own table, not audited — see `changeOrderStatus`).
 * Staff notes live in `OrderNote` (C5.7's own thread table). Delivery-status
 * pings (see `couriers.service.ts`'s `updateAssignmentStatus`) are
 * `AuditLog` rows with `entity: 'orders'`. Return approvals/rejections are
 * audited against `entity: 'return'`, `entityId: <returnId>` — NOT the
 * order — so they need their own query joined through `Return.orderId`.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────
 * "Emails sent" — there is no order-lifecycle customer email in this app at
 * all (only an internal support-alert mailer with no per-order log), so
 * there is nothing real to show. Fabricating a synthetic entry would be
 * worse than the gap.
 */
export async function getOrderTimeline(orderId: string): Promise<TimelineEvent[]> {
  const [statusHistory, notes, auditEntries, returns] = await Promise.all([
    prisma.orderStatusHistory.findMany({
      where: { orderId },
      select: { id: true, fromStatus: true, toStatus: true, note: true, changedById: true, createdAt: true },
    }),
    prisma.orderNote.findMany({
      where: { orderId },
      select: { id: true, body: true, authorId: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { entity: 'orders', entityId: orderId },
      select: { id: true, action: true, actorEmail: true, changes: true, createdAt: true },
    }),
    prisma.return.findMany({
      where: { orderId },
      select: { id: true, rmaNumber: true, status: true, resolution: true, refundAmount: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const staffIds = [
    ...new Set(
      [
        ...statusHistory.map((entry) => entry.changedById),
        ...notes.map((note) => note.authorId),
      ].filter((v) => v !== null),
    ),
  ];
  const staffUsers = staffIds.length
    ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
    : [];
  const staffNames = new Map(staffUsers.map((u) => [u.id, u.name]));

  // Return audit entries, keyed by return id, so their actor name can be
  // attached to the return's OWN timeline point below rather than shown as
  // a separate, redundant entry.
  const returnIds = returns.map((r) => r.id);
  const returnAuditEntries = returnIds.length
    ? await prisma.auditLog.findMany({
        where: { entity: 'return', entityId: { in: returnIds } },
        select: { entityId: true, action: true, actorEmail: true, createdAt: true },
      })
    : [];
  const returnActorByReturnId = new Map(
    returnAuditEntries.map((entry) => [entry.entityId, entry.actorEmail]),
  );

  const events: TimelineEvent[] = [
    ...statusHistory.map((entry) => ({
      id: `status-${entry.id}`,
      kind: 'status' as const,
      action: 'order.status.changed',
      actorName: staffNames.get(entry.changedById ?? '') ?? null,
      createdAt: entry.createdAt.toISOString(),
      detail: { fromStatus: entry.fromStatus, toStatus: entry.toStatus, note: entry.note },
    })),
    ...notes.map((note) => ({
      id: `note-${note.id}`,
      kind: 'note' as const,
      action: 'order.note.added',
      actorName: staffNames.get(note.authorId ?? '') ?? null,
      createdAt: note.createdAt.toISOString(),
      detail: { body: note.body },
    })),
    ...auditEntries.map((entry) => ({
      id: `audit-${entry.id}`,
      // The delivery-status ping added in couriers.service.ts is currently
      // the only non-status AuditLog action written against entity='orders'
      // (staff notes moved to their own OrderNote table above). Anything
      // else added later falls back to 'other' rather than silently
      // mis-tagging as a known kind.
      kind: entry.action === 'delivery.assignment.status_changed' ? ('delivery' as const) : ('other' as const),
      action: entry.action,
      actorName: entry.actorEmail,
      createdAt: entry.createdAt.toISOString(),
      detail: (entry.changes as Record<string, unknown> | null) ?? {},
    })),
    ...returns.map((ret) => ({
      id: `return-${ret.id}`,
      kind: 'return' as const,
      action: `return.${ret.status.toLowerCase()}`,
      actorName: returnActorByReturnId.get(ret.id) ?? null,
      // A return's own most recent change — REQUESTED uses createdAt (no
      // decision made yet), everything past that is a decision and
      // updatedAt reflects it.
      createdAt: (ret.status === 'REQUESTED' ? ret.createdAt : ret.updatedAt).toISOString(),
      detail: {
        rmaNumber: ret.rmaNumber,
        status: ret.status,
        resolution: ret.resolution,
        refundAmount: ret.refundAmount ? ret.refundAmount.toFixed(2) : null,
      },
    })),
  ];

  return events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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

export interface BulkStatusResult {
  succeeded: string[];
  skipped: { id: string; reason: string }[];
}

export interface BulkStatusPreview {
  /** How many of the given ids can legally make this exact move right now. */
  eligibleCount: number;
  /** How many will be skipped, and can never be un-skipped by retrying the
   *  same request — their current status already forbids this exact move. */
  ineligibleCount: number;
  /** Of the ELIGIBLE ones, how many carry a live courier assignment that
   *  will also be pushed forward by this move (see `ASSIGNMENT_ON_ORDER_STATUS`) —
   *  the dependency a bare "N orders selected" count doesn't surface. */
  withActiveAssignment: number;
  /** Whether `to` is a dead end (`ORDER_TRANSITIONS[to]` is empty) — once
   *  applied, none of the affected orders can be moved again, by this or any
   *  other action. */
  isTerminal: boolean;
}

/**
 * C5.5 — what a bulk status change would actually do, computed before the
 * user commits to it. Read-only; reuses the exact same `canTransition` the
 * real move (`bulkChangeOrderStatus`) validates against, so a count shown
 * here can never disagree with what actually happens a moment later.
 */
export async function previewBulkStatusChange(
  ids: string[],
  to: OrderStatus,
): Promise<BulkStatusPreview> {
  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, assignment: { select: { id: true, status: true } } },
  });

  const eligible = orders.filter((order) => canTransition(order.status, to));
  const withActiveAssignment = eligible.filter(
    (order) => order.assignment && ASSIGNMENT_ON_ORDER_STATUS[to] !== undefined,
  ).length;

  return {
    eligibleCount: eligible.length,
    ineligibleCount: orders.length - eligible.length,
    withActiveAssignment,
    isTerminal: nextStatuses(to).length === 0,
  };
}

/**
 * Move several orders to the same target status in one request.
 *
 * ─── EACH ORDER VALIDATES AGAINST ITS OWN CURRENT STATUS ─────────────
 * A bulk selection is very likely to contain orders at different points in
 * their lifecycle. There is no shortcut transition check here — every id
 * goes through the exact same `changeOrderStatus` a single-order PATCH would,
 * so "legal transition" has exactly one implementation in this codebase, not
 * a second copy that could silently drift from ORDER_TRANSITIONS.
 *
 * ─── BEST-EFFORT, NOT ALL-OR-NOTHING ──────────────────────────────────
 * One order having already moved on (someone else shipped it a minute ago)
 * must not roll back the other nine that were legally movable. Each id gets
 * its own outcome instead, mirroring the resource engine's bulk delete
 * (`Promise.allSettled`, never `Promise.all`) for the same reason: partial
 * success reported honestly beats an all-or-nothing failure hiding real work
 * that succeeded.
 */
export async function bulkChangeOrderStatus(
  ids: string[],
  input: ChangeStatusInput,
): Promise<BulkStatusResult> {
  const succeeded: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    try {
      await changeOrderStatus(id, input);
      succeeded.push(id);
    } catch (caught) {
      skipped.push({
        id,
        reason: caught instanceof AppError ? caught.message : 'Unexpected error',
      });
    }
  }

  return { succeeded, skipped };
}

/**
 * Add a note to the order's thread (C5.7) — staff-only, never surfaced to
 * the customer. Append-only like `OrderStatusHistory`, unlike the single
 * `Order.internalNotes` field this replaces: a second staff member's note no
 * longer silently overwrites the first one's.
 *
 * No `audit()` call — same reasoning as status moves: the note ROW is
 * itself the record of "who said what, and when", so a separate audit entry
 * describing the same fact would be a second, redundant copy of it.
 */
export async function addOrderNote(id: string, body: string, actorId: string) {
  const exists = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound('Order not found');

  await prisma.orderNote.create({ data: { orderId: id, body, authorId: actorId } });

  return getOrder(id);
}
