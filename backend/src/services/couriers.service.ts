import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  DeliveryStaffStatus,
  DeliveryStatus,
  Prisma,
  type OrderStatus,
} from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { ASSIGNMENT_ON_ORDER_STATUS } from '../config/orders.config.js';
import { audit, diff } from './audit.service.js';
import { resolveBranchLabels } from './branches.service.js';

/**
 * Couriers and their assignments.
 *
 * ─── ACCESS CODES ARE CREDENTIALS ────────────────────────────────────
 * A courier signs in to their own portal with a code instead of a staff
 * account, which makes that code a password. It is therefore never stored, and
 * never readable back — only a keyed HMAC of it is kept.
 *
 * Why HMAC and not bcrypt: bcrypt salts every hash, so a sign-in would have to
 * scan every courier and compare one by one. HMAC is deterministic, so the
 * unique index resolves a code in a single indexed read, while the stored value
 * is worthless to anyone who does not also hold the server secret.
 *
 * The honest limitation: HMAC is fast. Someone holding BOTH the database and
 * `DELIVERY_CODE_SECRET` could brute-force a short code offline. That is why
 * codes are long, drawn from a large alphabet, and why the portal sign-in is
 * rate-limited.
 */

const MAX_PAGE_SIZE = 100;

/** The work that still needs operational attention. Kept in one shared
 * constant so list filters, summary counts and tests cannot drift. */
export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.FAILED_ATTEMPT,
];

/**
 * No 0/O/1/I/L. Codes get read aloud down a phone line and copied off a screen
 * by someone holding a parcel — ambiguous glyphs turn into support calls.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 12 chars from a 31-char alphabet ≈ 59 bits. */
const CODE_LENGTH = 12;

/** Formatted in groups for readability; the separator is not part of the secret. */
function generateCode(): string {
  let code = '';

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt, not Math.random — this is a credential.
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }

  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/** Normalised before hashing so formatting and case never affect the result. */
function hashCode(code: string): string {
  const normalised = code.replace(/[\s-]/g, '').toUpperCase();

  return createHmac('sha256', env.DELIVERY_CODE_SECRET).update(normalised).digest('hex');
}

/**
 * Constant-time comparison.
 *
 * The lookup is by unique index so the timing of THAT is not a signal, but any
 * place two secrets are compared should not leak how far the match got.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');

  return left.length === right.length && timingSafeEqual(left, right);
}

/** Fields safe to return. `accessCodeHash` is never among them. */
const COURIER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  vehicleType: true,
  plateNumber: true,
  zone: true,
  region: true,
  country: true,
  status: true,
  createdAt: true,
} as const;

export interface CourierListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: DeliveryStaffStatus;
  /**
   * Restrict to couriers who have actually worked at one branch (F8).
   *
   * ─── WHAT THIS CAN AND CANNOT MEAN TODAY ─────────────────────────────
   * `DeliveryStaff` has NO branch column. A courier reaches a branch only
   * through the orders they have been assigned, so this filters on "has at
   * least one assignment for an order taken at this branch" — a record of
   * where they HAVE worked, not a roster of where they BELONG.
   *
   * ─── RESOLVED 2026-09-08 (O2) ──────────────────────────────────────
   * A courier now HAS branches (`DeliveryStaffBranch`), so this filters on
   * where they belong rather than where they have worked. The old filter
   * ("has an assignment for an order at this branch") made a newly hired
   * courier invisible on every scoped list until their first delivery —
   * precisely when a dispatcher most needs to find them.
   *
   * See `courierBranchWhere` for why a courier with NO branches recorded
   * still appears everywhere.
   */
  branchId?: string;
}

export async function listCouriers(params: CourierListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.DeliveryStaffWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...courierBranchWhere(params.branchId),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search } },
            { phone: { contains: params.search } },
            { zone: { contains: params.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.deliveryStaff.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...COURIER_FIELDS,
        // Whether a code exists is not secret; the code itself is.
        accessCodeHash: true,
        // O1.3: the roster can finally SAY where a courier works, now that
        // there is a truthful answer to give.
        branches: { select: { branch: { select: { id: true, name: true } } } },
        _count: {
          select: {
            assignments: {
              where: {
                status: {
                  in: [
                    DeliveryStatus.ASSIGNED,
                    DeliveryStatus.PICKED_UP,
                    DeliveryStatus.OUT_FOR_DELIVERY,
                  ],
                },
              },
            },
          },
        },
      },
    }),
    prisma.deliveryStaff.count({ where }),
  ]);

  return {
    couriers: rows.map(({ accessCodeHash, _count, branches, ...courier }) => ({
      ...courier,
      createdAt: courier.createdAt.toISOString(),
      hasAccessCode: accessCodeHash !== null,
      activeAssignments: _count.assignments,
      // An empty array means "not placed yet", never "belongs nowhere" — the
      // UI says so rather than leaving the cell blank.
      branches: branches.map((row) => row.branch),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCourier(id: string) {
  const courier = await prisma.deliveryStaff.findUnique({
    where: { id },
    select: {
      ...COURIER_FIELDS,
      accessCodeHash: true,
      // Same shape as the list (O2) — the detail page and the roster must not
      // disagree about where somebody works.
      branches: { select: { branch: { select: { id: true, name: true } } } },
      assignments: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          address: true,
          city: true,
          createdAt: true,
          order: { select: { id: true, orderNumber: true, status: true } },
        },
      },
    },
  });

  if (!courier) throw AppError.notFound('Courier not found');

  const { accessCodeHash, ...rest } = courier;

  return {
    ...rest,
    createdAt: rest.createdAt.toISOString(),
    hasAccessCode: accessCodeHash !== null,
    branches: rest.branches.map((row) => row.branch),
    assignments: rest.assignments.map((assignment) => ({
      ...assignment,
      createdAt: assignment.createdAt.toISOString(),
    })),
  };
}

export type DeliveryQueue = 'active' | 'failed' | 'all';

export interface DeliveryBoardParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: DeliveryStatus;
  driverId?: string;
  queue?: DeliveryQueue;
  from?: string;
  to?: string;
  branchId?: string;
}

/**
 * The admin delivery read model.
 *
 * Assignment writes already existed, but the only admin read was nested under
 * one courier or one order. This query is deliberately assignment-centred so
 * today's work, failures and unassigned operational context can be reviewed
 * without opening orders one at a time.
 */
export async function listDeliveryBoard(params: DeliveryBoardParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 50));
  const createdAt =
    params.from || params.to
      ? {
          ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
          ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const baseWhere: Prisma.DeliveryAssignmentWhereInput = {
    ...(params.driverId ? { driverId: params.driverId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(params.branchId ? { order: { branchId: params.branchId } } : {}),
    ...(params.search
      ? {
          OR: [
            { order: { orderNumber: { contains: params.search } } },
            { driver: { name: { contains: params.search } } },
            { customerName: { contains: params.search } },
            { customerPhone: { contains: params.search } },
            { address: { contains: params.search } },
            { city: { contains: params.search } },
          ],
        }
      : {}),
  };

  const queueWhere: Prisma.DeliveryAssignmentWhereInput =
    params.status !== undefined
      ? { status: params.status }
      : params.queue === 'failed'
        ? { status: DeliveryStatus.FAILED_ATTEMPT }
        : params.queue === 'all'
          ? {}
          : { status: { in: [...ACTIVE_DELIVERY_STATUSES] } };
  const where = { ...baseWhere, ...queueWhere };

  const [rows, total, grouped] = await prisma.$transaction([
    prisma.deliveryAssignment.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        customerName: true,
        customerPhone: true,
        address: true,
        city: true,
        total: true,
        paymentMethod: true,
        note: true,
        attemptCount: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
        driver: { select: { id: true, name: true, phone: true, status: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            branchId: true,
            placedAt: true,
          },
        },
      },
    }),
    prisma.deliveryAssignment.count({ where }),
    // Counts ignore only the queue/status choice, while retaining search,
    // courier, date and branch filters. Switching queues therefore never
    // changes the figures printed on the queue controls themselves.
    prisma.deliveryAssignment.groupBy({
      by: ['status'],
      where: baseWhere,
      orderBy: { status: 'asc' },
      _count: { _all: true },
    }),
  ]);

  const branches = await resolveBranchLabels(rows.map((row) => row.order.branchId));
  const counts = Object.fromEntries(
    Object.values(DeliveryStatus).map((status) => {
      const match = grouped.find((row) => row.status === status);
      const count =
        match && typeof match._count === 'object' ? (match._count._all ?? 0) : 0;
      return [status, count];
    }),
  ) as Record<DeliveryStatus, number>;

  return {
    assignments: rows.map((row) => ({
      ...row,
      total: row.total?.toFixed(2) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      order: {
        ...row.order,
        placedAt: row.order.placedAt.toISOString(),
        branch: row.order.branchId
          ? (branches.get(row.order.branchId) ?? null)
          : null,
      },
    })),
    counts,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface DeliveryTimelineParams {
  assignmentId: string;
  branchId?: string;
}

/**
 * One assignment's operational history, merged from the two sources that
 * already own it: courier field updates in AuditLog, and order status changes
 * that propagate into delivery status. No parallel history table is added.
 */
export async function getDeliveryTimeline(params: DeliveryTimelineParams) {
  const assignment = await prisma.deliveryAssignment.findFirst({
    where: {
      id: params.assignmentId,
      ...(params.branchId ? { order: { branchId: params.branchId } } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      orderId: true,
      driver: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true } },
    },
  });

  if (!assignment) throw AppError.notFound('Assignment not found');

  const [deliveryAudits, orderHistory] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entity: 'orders',
        entityId: assignment.orderId,
        action: {
          in: [
            'delivery.assignment.assigned',
            'delivery.assignment.reassigned',
            'delivery.assignment.details_updated',
            'delivery.assignment.status_changed',
          ],
        },
        createdAt: { gte: assignment.createdAt },
      },
      select: { id: true, action: true, actorEmail: true, changes: true, createdAt: true },
    }),
    prisma.orderStatusHistory.findMany({
      where: { orderId: assignment.orderId, createdAt: { gte: assignment.createdAt } },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        changedById: true,
        createdAt: true,
      },
    }),
  ]);

  const actorIds = orderHistory
    .map((entry) => entry.changedById)
    .filter((id): id is string => id !== null);
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(actorIds)] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  const hasCreationAudit = deliveryAudits.some(
    (entry) => entry.action === 'delivery.assignment.assigned',
  );
  const events = [
    ...(hasCreationAudit
      ? []
      : [
          {
            id: `created-${assignment.id}`,
            action: 'delivery.assignment.assigned',
            actorName: null,
            createdAt: assignment.createdAt.toISOString(),
            detail: {
              status: DeliveryStatus.ASSIGNED,
              driverId: assignment.driver.id,
              driverName: assignment.driver.name,
            },
          },
        ]),
    ...deliveryAudits.map((entry) => ({
      id: `audit-${entry.id}`,
      action: entry.action,
      actorName: entry.actorEmail,
      createdAt: entry.createdAt.toISOString(),
      detail: (entry.changes as Record<string, unknown> | null) ?? {},
    })),
    ...orderHistory.flatMap((entry) => {
      const toStatus = ASSIGNMENT_ON_ORDER_STATUS[entry.toStatus];
      if (!toStatus) return [];
      const actor = entry.changedById ? actorById.get(entry.changedById) : null;
      return [
        {
          id: `order-status-${entry.id}`,
          action: 'delivery.assignment.status_changed',
          actorName: actor?.name ?? actor?.email ?? null,
          createdAt: entry.createdAt.toISOString(),
          detail: {
            deliveryStatus: {
              from: entry.fromStatus ? (ASSIGNMENT_ON_ORDER_STATUS[entry.fromStatus] ?? null) : null,
              to: toStatus,
            },
            source: 'order',
            note: entry.note,
          },
        },
      ];
    }),
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  return {
    assignment: {
      id: assignment.id,
      order: assignment.order,
      driver: assignment.driver,
    },
    events,
  };
}

export interface CourierInput {
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
  vehicleType?: string | undefined;
  plateNumber?: string | undefined;
  zone?: string | undefined;
  region?: string | undefined;
  country?: string | undefined;
  status?: DeliveryStaffStatus | undefined;
}

export async function createCourier(input: CourierInput) {
  const courier = await prisma.deliveryStaff.create({
    data: { ...input },
    select: COURIER_FIELDS,
  });

  return { ...courier, createdAt: courier.createdAt.toISOString(), hasAccessCode: false };
}

export async function updateCourier(id: string, input: Partial<CourierInput>, req: Request) {
  const before = await prisma.deliveryStaff.findUnique({
    where: { id },
    select: { name: true, email: true, phone: true, zone: true, region: true, country: true, status: true },
  });
  if (!before) throw AppError.notFound('Courier not found');

  const courier = await prisma.deliveryStaff.update({
    where: { id },
    data: input,
    select: { ...COURIER_FIELDS, accessCodeHash: true },
  });

  const changes = diff(before, input);
  if (Object.keys(changes).length > 0) {
    audit(req, { action: 'courier.updated', entity: 'couriers', entityId: id, changes });
  }

  const { accessCodeHash, ...rest } = courier;

  return {
    ...rest,
    createdAt: rest.createdAt.toISOString(),
    hasAccessCode: accessCodeHash !== null,
  };
}

/**
 * Issue a new access code, invalidating any previous one.
 *
 * The plaintext is returned EXACTLY ONCE, here. There is no endpoint that
 * reads it back, because there is nothing stored to read — losing it means
 * issuing another, which is the correct behaviour for a credential.
 */
export async function regenerateAccessCode(id: string) {
  const courier = await prisma.deliveryStaff.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });

  if (!courier) throw AppError.notFound('Courier not found');

  if (courier.status === DeliveryStaffStatus.INACTIVE) {
    // Issuing working credentials to a deactivated courier is how access
    // outlives employment.
    throw AppError.badRequest('Reactivate this courier before issuing a code', {
      field: 'status',
    });
  }

  const code = generateCode();

  await prisma.deliveryStaff.update({
    where: { id },
    data: { accessCodeHash: hashCode(code) },
  });

  return { courier: { id: courier.id, name: courier.name }, code };
}

/** Remove a courier's ability to sign in, without deleting them. */
export async function revokeAccessCode(id: string) {
  const exists = await prisma.deliveryStaff.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound('Courier not found');

  await prisma.deliveryStaff.update({ where: { id }, data: { accessCodeHash: null } });
}

/**
 * Resolve a submitted code to a courier.
 *
 * Returns null for every failure — unknown code, deactivated courier — so the
 * caller cannot distinguish "no such code" from "that courier is suspended".
 * Telling them apart is an enumeration oracle.
 */
export async function courierForCode(code: string) {
  const hash = hashCode(code);

  const courier = await prisma.deliveryStaff.findUnique({
    where: { accessCodeHash: hash },
    select: { id: true, name: true, status: true, accessCodeHash: true },
  });

  if (!courier?.accessCodeHash) return null;
  if (!hashesMatch(courier.accessCodeHash, hash)) return null;
  if (courier.status === DeliveryStaffStatus.INACTIVE) return null;

  return { id: courier.id, name: courier.name };
}

export interface AssignInput {
  orderId: string;
  driverId: string;
  address?: string | undefined;
  city?: string | undefined;
  note?: string | undefined;
}

/**
 * Give an order to a courier.
 *
 * One assignment per order is enforced by a unique constraint, so reassigning
 * updates the existing row rather than creating a second — two couriers
 * holding the same parcel is a real-world failure, not just a data one.
 */
export async function assignOrder(input: AssignInput, req?: Request) {
  const [order, courier, existing] = await Promise.all([
    prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true, total: true, customer: { select: { name: true, phone: true } } },
    }),
    prisma.deliveryStaff.findUnique({
      where: { id: input.driverId },
      select: { id: true, name: true, status: true },
    }),
    prisma.deliveryAssignment.findUnique({
      where: { orderId: input.orderId },
      select: {
        status: true,
        driver: { select: { id: true, name: true } },
      },
    }),
  ]);

  if (!order) throw AppError.notFound('Order not found');
  if (!courier) throw AppError.notFound('Courier not found');

  if (courier.status === DeliveryStaffStatus.INACTIVE) {
    throw AppError.badRequest('That courier is inactive', { field: 'driverId' });
  }

  const finished: OrderStatus[] = ['DELIVERED', 'CANCELED', 'RETURNED'];

  if (finished.includes(order.status)) {
    throw AppError.badRequest(
      `This order is ${order.status.toLowerCase()} and needs no delivery`,
      { field: 'orderId' },
    );
  }

  const assignment = await prisma.deliveryAssignment.upsert({
    where: { orderId: input.orderId },
    create: {
      orderId: input.orderId,
      driverId: input.driverId,
      customerName: order.customer?.name ?? null,
      customerPhone: order.customer?.phone ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      note: input.note ?? null,
      total: order.total,
      status: DeliveryStatus.ASSIGNED,
    },
    update: {
      driverId: input.driverId,
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.note === undefined ? {} : { note: input.note }),
      // Reassigning restarts the delivery: the new courier has not picked it
      // up, and has not failed any attempt yet either — a new courier
      // starting on attempt "3" would be blamed for the last one's failures.
      // The failure is still visible in AuditLog for anyone who needs it.
      status: DeliveryStatus.ASSIGNED,
      attemptCount: 0,
      failureReason: null,
    },
    select: {
      id: true,
      status: true,
      address: true,
      city: true,
      note: true,
      attemptCount: true,
      failureReason: true,
      driver: { select: { id: true, name: true, phone: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  });

  if (req) {
    audit(req, {
      action: existing
        ? 'delivery.assignment.reassigned'
        : 'delivery.assignment.assigned',
      entity: 'orders',
      entityId: input.orderId,
      changes: {
        driver: {
          from: existing
            ? { id: existing.driver.id, name: existing.driver.name }
            : null,
          to: { id: courier.id, name: courier.name },
        },
        status: {
          from: existing?.status ?? null,
          to: DeliveryStatus.ASSIGNED,
        },
      },
    });
  }

  return assignment;
}

export interface UpdateAssignmentInput {
  address?: string | undefined;
  city?: string | undefined;
  note?: string | undefined;
}

/**
 * Corrects the delivery address/city/note WITHOUT reassigning — B4.1. Before
 * this, the only way to fix a wrong address was `assignOrder`'s upsert,
 * which also resets `status` back to ASSIGNED (correct for a real
 * reassignment, wrong for "same courier, I mistyped the street"). A courier
 * who already picked the order up should not be reset to ASSIGNED just
 * because staff fixed a typo.
 *
 * Terminal deliveries (DELIVERED) are refused for the same reason
 * `unassignOrder` refuses to delete one — editing the record of a completed
 * delivery erases what actually happened.
 */
export async function updateAssignment(
  assignmentId: string,
  input: UpdateAssignmentInput,
  req?: Request,
) {
  const existing = await prisma.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      orderId: true,
      status: true,
      address: true,
      city: true,
      note: true,
    },
  });

  if (!existing) throw AppError.notFound('Assignment not found');

  if (existing.status === DeliveryStatus.DELIVERED) {
    throw AppError.badRequest('This delivery is already complete', { field: 'status' });
  }

  const assignment = await prisma.deliveryAssignment.update({
    where: { id: assignmentId },
    data: {
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    select: {
      id: true,
      status: true,
      address: true,
      city: true,
      note: true,
      attemptCount: true,
      failureReason: true,
      driver: { select: { id: true, name: true, phone: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  });

  const changes = diff(
    { address: existing.address, city: existing.city, note: existing.note },
    { ...input },
  );
  if (req && Object.keys(changes).length > 0) {
    audit(req, {
      action: 'delivery.assignment.details_updated',
      entity: 'orders',
      entityId: existing.orderId,
      changes,
    });
  }

  return assignment;
}

/**
 * What a COURIER may set on their own assignment, self-reported from the
 * field. Deliberately narrower than the full `DeliveryStatus` enum:
 * OUT_FOR_DELIVERY/DELIVERED/CANCELED/RETURNED can ALSO arrive top-down from
 * the order side (see `ASSIGNMENT_ON_ORDER_STATUS` in orders.config.ts).
 * CANCELED and RETURNED stay staff-only here — they follow business rules
 * (return approval, order cancellation) a courier has no visibility into and
 * must not be able to shortcut. Confirming DELIVERED here updates only the
 * ASSIGNMENT, never the order itself — the order's own status stays the
 * staff side's call, the same one-way direction `ASSIGNMENT_ON_ORDER_STATUS`
 * already established (order → assignment, never the reverse).
 */
const COURIER_TRANSITIONS: Readonly<Partial<Record<DeliveryStatus, readonly DeliveryStatus[]>>> = {
  [DeliveryStatus.ASSIGNED]: [DeliveryStatus.PICKED_UP],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.HANDED_OVER],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.HANDED_OVER,
    DeliveryStatus.FAILED_ATTEMPT,
  ],
  // Re-triable, not terminal: the same job goes back OUT_FOR_DELIVERY for
  // another attempt. `attemptCount` (bumped on the way IN to this status)
  // is what tells staff "this is the 3rd attempt" without a separate log.
  [DeliveryStatus.FAILED_ATTEMPT]: [DeliveryStatus.OUT_FOR_DELIVERY, DeliveryStatus.HANDED_OVER],
};

/** Fields a courier needs to actually make the delivery, and nothing else —
 *  no other couriers, no other customers' data beyond what this job needs.
 *
 *  ONE constant, shared by every endpoint that returns an assignment to a
 *  courier. It is not a tidiness preference: the portal patches a status and
 *  splices the response into the list it already holds, so a narrower select
 *  on the write path replaces a complete row with a stub and the card renders
 *  blank. Two selects drifted exactly that way once (O6). Widening this is
 *  safe; narrowing it for one caller is the bug. */
const COURIER_ASSIGNMENT_SELECT = {
  id: true,
  status: true,
  customerName: true,
  customerPhone: true,
  address: true,
  area: true,
  city: true,
  total: true,
  paymentMethod: true,
  note: true,
  attemptCount: true,
  failureReason: true,
  createdAt: true,
  order: { select: { id: true, orderNumber: true } },
} as const;

type CourierAssignmentRow = Prisma.DeliveryAssignmentGetPayload<{
  select: typeof COURIER_ASSIGNMENT_SELECT;
}>;

/**
 * The single serialiser for a courier-facing assignment.
 *
 * `total` is a Prisma `Decimal`, which `res.json` renders as a bare number and
 * loses trailing zeros on — the client type has always declared `string | null`.
 * Converting here, once, keeps the wire shape honest on both paths rather than
 * relying on `Number(value)` at the call site to absorb whichever type arrives.
 */
function toCourierAssignment(assignment: CourierAssignmentRow) {
  return {
    ...assignment,
    total: assignment.total === null ? null : assignment.total.toString(),
    createdAt: assignment.createdAt.toISOString(),
  };
}

export async function listOwnAssignments(courierId: string) {
  const assignments = await prisma.deliveryAssignment.findMany({
    where: { driverId: courierId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: COURIER_ASSIGNMENT_SELECT,
  });

  return assignments.map(toCourierAssignment);
}

/**
 * A courier reporting progress on THEIR OWN assignment.
 *
 * "Not found" covers both "no such assignment" and "not yours" — same
 * enumeration-safe shape as `courierForCode`. A courier probing another
 * courier's assignment id must not be able to tell the two apart.
 */
export async function updateAssignmentStatus(
  assignmentId: string,
  courierId: string,
  courierName: string,
  nextStatus: DeliveryStatus,
  req: Request,
  failureReason?: string,
) {
  const assignment = await prisma.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, driverId: true, status: true, orderId: true },
  });

  if (!assignment || assignment.driverId !== courierId) {
    throw AppError.notFound('Assignment not found');
  }

  const allowed = COURIER_TRANSITIONS[assignment.status] ?? [];

  if (!allowed.includes(nextStatus)) {
    throw AppError.badRequest(
      `Cannot move from ${assignment.status} to ${nextStatus}`,
      { field: 'status' },
    );
  }

  // A reason is how staff tell attempt 1 from attempt 3 apart later — make
  // it required at the point of failure rather than an optional field
  // couriers can skip under pressure.
  if (nextStatus === DeliveryStatus.FAILED_ATTEMPT && !failureReason?.trim()) {
    throw AppError.badRequest('A reason is required to report a failed attempt', {
      field: 'failureReason',
    });
  }

  // Same select as the list endpoint — the portal splices this response
  // straight into the array it already has, so anything missing here renders
  // as an emptied card until the next refresh.
  const updated = await prisma.deliveryAssignment.update({
    where: { id: assignmentId },
    data: {
      status: nextStatus,
      ...(nextStatus === DeliveryStatus.FAILED_ATTEMPT
        ? { attemptCount: { increment: 1 }, failureReason: failureReason!.trim() }
        : {}),
    },
    select: COURIER_ASSIGNMENT_SELECT,
  });

  // A courier is not a `User` and has no email — `courierName` fills the
  // "who a reviewer recognises" role `actorEmail` normally plays for staff.
  // This is the ONLY history of an assignment's status trail (C5.4):
  // DeliveryAssignment stores current status only, no separate log table.
  audit(req, {
    action: 'delivery.assignment.status_changed',
    entity: 'orders',
    entityId: assignment.orderId,
    changes: {
      deliveryStatus: { from: assignment.status, to: nextStatus },
      ...(nextStatus === DeliveryStatus.FAILED_ATTEMPT
        ? { failureReason: { from: null, to: updated.failureReason } }
        : {}),
    },
    actor: { id: courierId, email: courierName, role: 'COURIER' },
  });

  return toCourierAssignment(updated);
}

export async function unassignOrder(assignmentId: string) {
  const assignment = await prisma.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, status: true },
  });

  if (!assignment) throw AppError.notFound('Assignment not found');

  if (assignment.status === DeliveryStatus.DELIVERED) {
    // Deleting a completed delivery erases the record that it happened.
    throw AppError.badRequest('This delivery is already complete', { field: 'status' });
  }

  await prisma.deliveryAssignment.delete({ where: { id: assignmentId } });
}

/* ─────────────────────────────────────────────────────────────────────
 * WHICH BRANCHES A COURIER SERVES (O2)
 *
 * The owner's answer, 2026-09-08: a courier can serve one branch and another
 * as well. So this is a join table, not a `branchId` column, and one courier
 * record rather than one per branch — their access code, phone and delivery
 * history stay in one place.
 *
 * ─── WHY THIS REPLACES THE ASSIGNMENT-HISTORY FILTER ─────────────────
 * PR #155 scoped the courier roster by "has an assignment for an order at this
 * branch" — where they have WORKED, not where they BELONG. That made a newly
 * hired courier invisible on every scoped list until their first delivery,
 * which is exactly when a dispatcher most needs to find them.
 * ───────────────────────────────────────────────────────────────────── */

/** The branches this courier serves, for the detail page and the form. */
export async function listCourierBranches(courierId: string) {
  const rows = await prisma.deliveryStaffBranch.findMany({
    where: { courierId },
    select: { branch: { select: { id: true, name: true, code: true, isActive: true } } },
    orderBy: { branch: { name: 'asc' } },
  });

  return rows.map((row) => row.branch);
}

/**
 * Replace the whole set in one transaction.
 *
 * A full replace rather than add/remove endpoints: the UI edits this as a set
 * of checkboxes, and applying a diff computed on a stale client is how a
 * branch nobody touched gets removed. Sending the intended final state means
 * the last writer wins predictably instead of partially.
 */
export async function setCourierBranches(courierId: string, branchIds: string[]) {
  const courier = await prisma.deliveryStaff.findUnique({
    where: { id: courierId },
    select: { id: true },
  });

  if (!courier) throw AppError.notFound('Courier not found');

  const wanted = [...new Set(branchIds)];

  if (wanted.length > 0) {
    const found = await prisma.branch.count({ where: { id: { in: wanted } } });

    // Refused as a whole rather than silently keeping the ids that resolve —
    // a partially applied roster is harder to notice than a rejected one.
    if (found !== wanted.length) {
      throw AppError.badRequest('One or more branches do not exist', { field: 'branchIds' });
    }
  }

  await prisma.$transaction([
    prisma.deliveryStaffBranch.deleteMany({
      where: { courierId, branchId: { notIn: wanted.length > 0 ? wanted : [''] } },
    }),
    ...wanted.map((branchId) =>
      prisma.deliveryStaffBranch.upsert({
        where: { courierId_branchId: { courierId, branchId } },
        create: { courierId, branchId },
        update: {},
      }),
    ),
  ]);

  return listCourierBranches(courierId);
}

/**
 * The `where` clause that scopes a courier list to one branch.
 *
 * ─── A COURIER WITH NO BRANCHES IS VISIBLE EVERYWHERE, ON PURPOSE ────
 * Every courier that existed before this shipped has no rows here, and an
 * empty relation would hide all of them from every scoped list the moment it
 * deployed — a migration that silently empties a screen. So "no branches
 * recorded" means "not yet placed", and such a courier still appears; only a
 * courier explicitly assigned elsewhere is filtered out.
 *
 * This is the same direction as `UserBranch`'s "no row means the global role":
 * an upgrade grants nothing and takes nothing away.
 */
export function courierBranchWhere(branchId: string | undefined) {
  if (!branchId) return {};

  return {
    OR: [{ branches: { some: { branchId } } }, { branches: { none: {} } }],
  };
}
