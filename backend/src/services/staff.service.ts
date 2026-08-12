import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { canAssignRole, outranks } from '../config/roles.js';
import { createResetToken } from './password-reset.service.js';

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

/**
 * Rule 1 + the email-uniqueness check, shared by `createStaff` and
 * `inviteStaff` — the two ways a new account comes into being differ only in
 * where the password comes from, not in whether the account is allowed to
 * exist at all.
 */
async function assertCanCreate(actor: Actor, email: string, role: StaffRole): Promise<void> {
  if (!canAssignRole(actor.role, role)) {
    throw AppError.forbidden('You cannot grant a role with more access than your own', {
      field: 'role',
    });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (existing) {
    // 409 naming the field, not a 500 leaking the unique constraint.
    throw AppError.conflict('That email address is already in use', { field: 'email' });
  }
}

export async function createStaff(actor: Actor, input: CreateStaffInput) {
  await assertCanCreate(actor, input.email, input.role);

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

export interface InviteStaffInput {
  email: string;
  name?: string | undefined;
  phone?: string | undefined;
  role: StaffRole;
  accessExpiresAt?: string | undefined;
}

/** An invite never has an admin choose the token's lifetime — it is not a
 * live handover, and 30 minutes (the reset default) would expire before most
 * people open the message it arrived in. */
const INVITE_TOKEN_TTL_MINUTES = 24 * 60;

/**
 * Create a staff account with NO password anyone ever knows, and hand the
 * caller a one-time token to activate it — the primary action the spec names
 * for this page, which did not exist: accounts could only be created with the
 * admin typing a password on the new person's behalf.
 *
 * ─── WHY NOT JUST `createStaff` WITH A RANDOM PASSWORD RETURNED ──────
 * Returning the generated password would mean the ADMIN saw it, which is
 * exactly the thing an invite is supposed to avoid — same reasoning
 * `issueStaffPasswordResetToken`'s doc comment gives for using a token
 * instead of `resetStaffPassword`. The random password here exists only to
 * satisfy the column's NOT NULL constraint and is discarded immediately;
 * nothing ever reads it back.
 */
export async function inviteStaff(actor: Actor, input: InviteStaffInput) {
  await assertCanCreate(actor, input.email, input.role);

  // 32 random bytes, hashed and thrown away — never logged, returned, or
  // reachable again. Long enough that even a modelling mistake elsewhere
  // could not make it guessable within the token's lifetime.
  const unusedPassword = randomBytes(32).toString('hex');

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      role: input.role,
      passwordHash: await bcrypt.hash(unusedPassword, 10),
      accessExpiresAt: input.accessExpiresAt ? new Date(input.accessExpiresAt) : null,
    },
    select: STAFF_FIELDS,
  });

  const { token, expiresAt } = await createResetToken(user.id, INVITE_TOKEN_TTL_MINUTES);

  return { staff: serialise(user), token, expiresAt: expiresAt.toISOString() };
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

export interface UpdateOwnProfileInput {
  name?: string | undefined;
  phone?: string | undefined;
}

/**
 * A staff member editing their own name/phone.
 *
 * Deliberately NOT `updateStaff` with `id === actor.id` — that function's
 * `isSelf` branches exist to REFUSE self-edits of role/isActive/expiry, and
 * this path must not accept those fields at all, not merely refuse to apply
 * them. A narrower input type is the actual protection; the route layer
 * choosing not to send the other fields is not.
 */
export async function updateOwnProfile(actor: Actor, input: UpdateOwnProfileInput) {
  const user = await prisma.user.update({
    where: { id: actor.id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
    },
    select: STAFF_FIELDS,
  });

  return serialise(user);
}

/**
 * A staff member changing their own password.
 *
 * The one rule every OTHER password path in this file is exempt from: the
 * caller must prove they still know the CURRENT password. `resetStaffPassword`
 * and the admin-issued reset token both exist precisely because an admin can
 * act without that proof — this is the path where nothing else vouches for
 * the caller beyond an already-issued session token, so re-checking the
 * password is the only thing standing between "I left my laptop unlocked" and
 * a silent credential change.
 *
 * Revokes every session, same as every other password change in this file —
 * including the one making this request. The caller gets a FRESH token back
 * in the response so their own change does not immediately log them out; an
 * admin resetting someone ELSE's password has no equivalent need, which is
 * why `resetStaffPassword` doesn't return one.
 */
export async function changeOwnPassword(
  actor: Actor,
  currentPassword: string,
  newPassword: string,
): Promise<{ passwordHash: string; tokenVersion: number }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { passwordHash: true },
  });

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    throw AppError.badRequest('Current password is incorrect', {
      field: 'currentPassword',
    });
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        tokenVersion: { increment: 1 },
      },
      select: { passwordHash: true, tokenVersion: true },
    }),
    /**
     * Keeps `session.service.ts`'s list truthful. Without this, every
     * pre-existing `Session` row (including the one this very request is
     * using) stays `revokedAt: null` even though its token just went dead on
     * the `tokenVersion` check above — the sessions list would show a device
     * as "live" that can never authenticate again.
     */
    prisma.session.updateMany({
      where: { userId: actor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return updated;
}

/**
 * Issue a one-time reset token instead of setting the password directly.
 *
 * Same rank rules as every other write here (via `loadSubject`) — an admin
 * can issue a token for anyone at or below their own rank, never upward.
 * The plaintext token is returned exactly once, to be handed to the locked-out
 * person out of band; nothing stores it, so losing it means issuing another.
 */
export async function issueStaffPasswordResetToken(actor: Actor, id: string) {
  const subject = await loadSubject(actor, id);

  const { token, expiresAt } = await createResetToken(subject.id);

  return {
    staff: { id: subject.id, email: subject.email },
    token,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Transfer ownership — promote another active staff member to OWNER and step
 * the caller down to MANAGER, atomically.
 *
 * ─── WHY THIS CANNOT GO THROUGH `updateStaff` ─────────────────────────
 * `updateStaff`'s `isSelf` branch hard-refuses changing your own role, by
 * design (rule 2 — no self-elevation). That rule is correct for every OTHER
 * path into this file, but it also makes "hand off the account" impossible
 * for the one role for whom nobody outranks them enough to do it on their
 * behalf. This function is the one deliberate, narrow exception: it accepts
 * exactly one shape of self-change (OWNER → MANAGER, paired with promoting
 * someone else to OWNER in the SAME transaction) and nothing else, so it
 * cannot be repurposed into a general self-role-change escape hatch.
 *
 * ─── WHY IT REQUIRES THE CURRENT PASSWORD ─────────────────────────────
 * Same reasoning as `changeOwnPassword`: an already-issued session token is
 * the only thing vouching for the caller, and this is the single most
 * consequential write in the app. Re-proving the password is the one thing
 * standing between "I left my laptop unlocked" and losing the account.
 *
 * ─── RULE 4 STILL HOLDS ────────────────────────────────────────────────
 * The target is promoted BEFORE the actor is demoted (same transaction, but
 * order matters for the invariant this file is built around): there is never
 * a moment with fewer active owners than there were before the call, and if
 * anything else in the transaction fails, neither write commits.
 */
export async function transferOwnership(
  actor: Actor,
  targetId: string,
  currentPassword: string,
): Promise<{ newOwner: ReturnType<typeof serialise>; self: ReturnType<typeof serialise> }> {
  if (actor.role !== StaffRole.OWNER) {
    throw AppError.forbidden('Only an owner can transfer ownership');
  }

  if (targetId === actor.id) {
    throw AppError.badRequest('Choose someone else to transfer ownership to', {
      field: 'targetId',
    });
  }

  const [self, target] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { id: true, passwordHash: true },
    }),
    prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isActive: true },
    }),
  ]);

  if (!target) throw AppError.notFound('Staff member not found');
  if (!target.isActive) {
    throw AppError.badRequest('Cannot transfer ownership to a deactivated account', {
      field: 'targetId',
    });
  }

  const matches = await bcrypt.compare(currentPassword, self.passwordHash);
  if (!matches) {
    throw AppError.badRequest('Current password is incorrect', {
      field: 'currentPassword',
    });
  }

  const now = new Date();

  const [newOwnerRow, selfRow] = await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: { role: StaffRole.OWNER, tokenVersion: { increment: 1 } },
      select: STAFF_FIELDS,
    }),
    prisma.user.update({
      where: { id: actor.id },
      data: { role: StaffRole.MANAGER, tokenVersion: { increment: 1 } },
      select: STAFF_FIELDS,
    }),
    // Both accounts' existing sessions are now signed with a stale role
    // claim — revoked the same way `updateStaff`'s role-change branch does.
    prisma.session.updateMany({
      where: { userId: { in: [target.id, actor.id] }, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  return { newOwner: serialise(newOwnerRow), self: serialise(selfRow) };
}
