import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  DeliveryStaffStatus,
  DeliveryStatus,
  Prisma,
  type OrderStatus,
} from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

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
}

export async function listCouriers(params: CourierListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.DeliveryStaffWhereInput = {
    ...(params.status ? { status: params.status } : {}),
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
    couriers: rows.map(({ accessCodeHash, _count, ...courier }) => ({
      ...courier,
      createdAt: courier.createdAt.toISOString(),
      hasAccessCode: accessCodeHash !== null,
      activeAssignments: _count.assignments,
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
    assignments: rest.assignments.map((assignment) => ({
      ...assignment,
      createdAt: assignment.createdAt.toISOString(),
    })),
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

export async function updateCourier(id: string, input: Partial<CourierInput>) {
  const exists = await prisma.deliveryStaff.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound('Courier not found');

  const courier = await prisma.deliveryStaff.update({
    where: { id },
    data: input,
    select: { ...COURIER_FIELDS, accessCodeHash: true },
  });

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
export async function assignOrder(input: AssignInput) {
  const [order, courier] = await Promise.all([
    prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true, total: true, customer: { select: { name: true, phone: true } } },
    }),
    prisma.deliveryStaff.findUnique({
      where: { id: input.driverId },
      select: { id: true, status: true },
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
      // Reassigning restarts the delivery: the new courier has not picked it up.
      status: DeliveryStatus.ASSIGNED,
    },
    select: {
      id: true,
      status: true,
      address: true,
      city: true,
      note: true,
      driver: { select: { id: true, name: true, phone: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  });

  return assignment;
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
