import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { canAssignRole, outranks } from '../config/roles.js';

/**
 * Staff accounts.
 *
 * ─── WHY THIS IS NOT A CONFIGURED RESOURCE ───────────────────────────
 * `users` is deliberately absent from admin.config.ts. The engine builds its
 * `select` from a field list, so one careless config entry would expose
 * `passwordHash` — and its writes are a generic field merge, which is exactly
 * the shape a privilege-escalation bug takes. Access control cannot be a
 * config block.
 *
 * ─── THE FOUR RULES THIS FILE EXISTS TO ENFORCE ──────────────────────
 * 1. Nobody grants a role above their own rank.  (escalation)
 * 2. Nobody changes their own role at all.       (self-elevation)
 * 3. Nobody modifies someone who outranks them.  (lateral attack)
 * 4. The last active owner cannot be removed.    (lockout)
 *
 * Every one is enforced HERE, in the service, not in the route — so a second
 * caller added later cannot bypass them by forgetting a check.
 */

const MAX_PAGE_SIZE = 100;

/**
 * Never includes `passwordHash`.
 *
 * An explicit allowlist rather than `omit`: a field added to the model later
 * is absent by default instead of silently joining every response.
 */
const STAFF_FIELDS = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  accessExpiresAt: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
} as const;

type Actor = { id: string; role: StaffRole };

/**
 * Generic so the caller's field set survives. A non-generic parameter with an
 * index signature widens the return type and loses `id`, `role` and the rest —
 * which then only shows up at the call site, far from the cause.
 */
function serialise<
  T extends {
    createdAt: Date;
    lastLoginAt: Date | null;
    accessExpiresAt: Date | null;
    lockedUntil: Date | null;
  },
>(user: T) {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    accessExpiresAt: user.accessExpiresAt?.toISOString() ?? null,
    // Surfaced so an admin can see WHY someone cannot sign in, rather than
    // being told the password is fine and left guessing.
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
  };
}

export interface StaffListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: StaffRole;
  isActive?: boolean;
}

export async function listStaff(params: StaffListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.UserWhereInput = {
    ...(params.role ? { role: params.role } : {}),
    ...(params.isActive === undefined ? {} : { isActive: params.isActive }),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search } },
            { email: { contains: params.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: STAFF_FIELDS,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    staff: rows.map(serialise),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** How many owners could still sign in. Guards rule 4. */
async function activeOwnerCount(): Promise<number> {
  return prisma.user.count({
    where: { role: StaffRole.OWNER, isActive: true },
  });
}

/** Loads the subject and applies rules 2 and 3 before anything is written. */
async function loadSubject(actor: Actor, id: string) {
  const subject = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true, email: true },
  });

  if (!subject) throw AppError.notFound('Staff member not found');

  // Rule 3. Equal rank is allowed — peers manage each other — but nobody
  // reaches upward.
  if (outranks(subject.role, actor.role)) {
    throw AppError.forbidden('You cannot modify someone with more access than you');
  }

  return subject;
}

export interface CreateStaffInput {
  email: string;
  name?: string | undefined;
  phone?: string | undefined;
  role: StaffRole;
  password: string;
  accessExpiresAt?: string | undefined;
}

export async function createStaff(actor: Actor, input: CreateStaffInput) {
  // Rule 1.
  if (!canAssignRole(actor.role, input.role)) {
    throw AppError.forbidden('You cannot grant a role with more access than your own', {
      field: 'role',
    });
  }

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    // 409 naming the field, not a 500 leaking the unique constraint.
    throw AppError.conflict('That email address is already in use', { field: 'email' });
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, 10),
      accessExpiresAt: input.accessExpiresAt ? new Date(input.accessExpiresAt) : null,
    },
    select: STAFF_FIELDS,
  });

  return serialise(user);
}

export interface UpdateStaffInput {
  name?: string | undefined;
  phone?: string | undefined;
  role?: StaffRole | undefined;
  isActive?: boolean | undefined;
  accessExpiresAt?: string | null | undefined;
}

export async function updateStaff(actor: Actor, id: string, input: UpdateStaffInput) {
  const subject = await loadSubject(actor, id);
  const isSelf = subject.id === actor.id;

  if (input.role !== undefined && input.role !== subject.role) {
    // Rule 2. Blocked in BOTH directions: elevation is the attack, and a
    // self-demotion that removes the last owner is the lockout.
    if (isSelf) {
      throw AppError.forbidden('You cannot change your own role', { field: 'role' });
    }

    // Rule 1.
    if (!canAssignRole(actor.role, input.role)) {
      throw AppError.forbidden('You cannot grant a role with more access than your own', {
        field: 'role',
      });
    }

    // Rule 4 — demoting the last owner locks everyone out of staff management.
    if (subject.role === StaffRole.OWNER && (await activeOwnerCount()) <= 1) {
      throw AppError.badRequest(
        'This is the last active owner — promote another owner first',
        { field: 'role' },
      );
    }
  }

  if (input.isActive === false) {
    if (isSelf) {
      // Locking yourself out is never intentional, and recovering needs
      // another admin.
      throw AppError.forbidden('You cannot deactivate your own account', {
        field: 'isActive',
      });
    }

    // Rule 4 again, by the other route.
    if (subject.role === StaffRole.OWNER && (await activeOwnerCount()) <= 1) {
      throw AppError.badRequest(
        'This is the last active owner — promote another owner first',
        { field: 'isActive' },
      );
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.accessExpiresAt === undefined
        ? {}
        : { accessExpiresAt: input.accessExpiresAt ? new Date(input.accessExpiresAt) : null }),
      /**
       * Deactivating REVOKES every session.
       *
       * `getAuthenticatedUser` already refuses an inactive user on each
       * request, so this is belt and braces — but it is the difference between
       * "their next request fails" and "their token is dead". If that check is
       * ever relaxed for performance, this still holds.
       *
       * A role CHANGE also revokes: the old token carries the old role in its
       * payload, and anything reading the token rather than the row would keep
       * honouring privileges that were just taken away.
       */
      ...(input.isActive === false || (input.role !== undefined && input.role !== subject.role)
        ? { tokenVersion: { increment: 1 } }
        : {}),
    },
    select: STAFF_FIELDS,
  });

  return serialise(user);
}

/**
 * Clear a brute-force lockout.
 *
 * Separate from `updateStaff` because it is an operational action, not a
 * change to who someone is — and it must not require sending the whole record
 * back, which would let an unrelated field ride along.
 */
export async function unlockStaff(actor: Actor, id: string) {
  await loadSubject(actor, id);

  const user = await prisma.user.update({
    where: { id },
    data: { lockedUntil: null, failedLoginAttempts: 0 },
    select: STAFF_FIELDS,
  });

  return serialise(user);
}

/**
 * Set a new password for someone else.
 *
 * Deliberately does NOT return anything about the password. There is no
 * "show me what I set" — the caller typed it and can read their own form.
 */
export async function resetStaffPassword(actor: Actor, id: string, password: string) {
  const subject = await loadSubject(actor, id);

  const user = await prisma.user.update({
    where: { id: subject.id },
    data: {
      passwordHash: await bcrypt.hash(password, 10),
      // A reset clears a lockout: the credential that was being guessed no
      // longer exists.
      lockedUntil: null,
      failedLoginAttempts: 0,
      /**
       * REVOKE EVERY EXISTING SESSION.
       *
       * Without this, changing someone's password does not lock them — or
       * whoever took their laptop — out. The old token stays valid for up to
       * seven days, which makes "I reset their password" mean nothing.
       */
      tokenVersion: { increment: 1 },
    },
    select: STAFF_FIELDS,
  });

  return serialise(user);
}
