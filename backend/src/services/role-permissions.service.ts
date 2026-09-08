import { StaffRole } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { AREAS, ROLE_AREAS, areasFor, type Area } from '../config/roles.js';

/**
 * What a role may reach, after the owner's overrides (O8).
 *
 * ─── THE CODE DEFAULT IS STILL THE DEFAULT ───────────────────────────
 * `ROLE_AREAS` is not replaced. A role with no row in `role_permissions`
 * behaves exactly as it always did, so shipping this granted nobody anything
 * and took nothing away — the same discipline `UserBranch` follows ("no row
 * means the global role").
 *
 * It also means a later release adding a new AREA reaches existing installs:
 * had the full set been stored per role on first save, every role would carry
 * a list that silently excludes anything added afterwards.
 *
 * ─── OWNER AND DEVELOPER ARE NEVER OVERRIDDEN ────────────────────────
 * The owner's decision, 2026-09-08. Enforced HERE rather than only in the UI:
 * an owner who unticked their own `settings` box would lose the very screen
 * that ticks it back, and recovery would need database access. A stray row
 * for either role is ignored on read as well as refused on write, so even a
 * hand-written INSERT cannot lock anyone out.
 *
 * ─── WHY A CACHE, AND WHY A SHORT ONE ────────────────────────────────
 * `canAccessArea` runs on essentially every authenticated request. Reading a
 * table each time would put a query in front of every screen for a value that
 * changes a few times a year.
 *
 * The TTL is what makes "applies on the next page load" true (also the
 * owner's decision, over signing everyone out): a change is live within
 * seconds, and nobody mid-task is interrupted. The cache is cleared outright
 * on write, so the person who made the change sees it immediately — the TTL
 * only covers OTHER server instances, which is exactly where a few seconds of
 * staleness is acceptable and a distributed invalidation would not be worth
 * its complexity.
 */

const CACHE_TTL_MS = 15_000;

/** Roles whose access is fixed in code and can never be narrowed. */
const LOCKED_ROLES: readonly StaffRole[] = [StaffRole.DEVELOPER, StaffRole.OWNER];

export function isLockedRole(role: StaffRole): boolean {
  return LOCKED_ROLES.includes(role);
}

let cache: { at: number; overrides: Map<StaffRole, Area[]> } | null = null;

/** Called after any write, so the change is visible immediately here. */
export function clearRolePermissionCache(): void {
  cache = null;
}

function isArea(value: unknown): value is Area {
  return typeof value === 'string' && (AREAS as readonly string[]).includes(value);
}

async function loadOverrides(): Promise<Map<StaffRole, Area[]>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.overrides;

  const rows = await prisma.rolePermission.findMany({ select: { role: true, areas: true } });

  const overrides = new Map<StaffRole, Area[]>();

  for (const row of rows) {
    // A locked role's row is ignored rather than trusted — see the note above
    // on why a hand-written INSERT must not be able to lock anyone out.
    if (isLockedRole(row.role)) continue;

    // The column is `Json`, so its contents are whatever was written. Filtered
    // rather than cast: an area removed from the code in a later release would
    // otherwise survive here as a string nothing recognises.
    if (Array.isArray(row.areas)) {
      overrides.set(row.role, row.areas.filter(isArea));
    }
  }

  cache = { at: Date.now(), overrides };

  return overrides;
}

/** Every area this role may reach, overrides applied. */
export async function resolveAreas(role: StaffRole): Promise<readonly Area[]> {
  if (isLockedRole(role)) return AREAS;

  const overrides = await loadOverrides();

  return overrides.get(role) ?? areasFor(role);
}

export async function canAccessAreaResolved(role: StaffRole, area: Area): Promise<boolean> {
  return (await resolveAreas(role)).includes(area);
}

/** Every role with its resolved areas, for the permissions matrix. */
export async function listRolePermissions() {
  const roles = Object.keys(ROLE_AREAS) as StaffRole[];

  return Promise.all(
    roles.map(async (role) => ({
      role,
      areas: [...(await resolveAreas(role))],
      /** Locked roles render read-only; the API refuses them either way. */
      isLocked: isLockedRole(role),
      /** Whether an owner has changed this from the shipped default — worth
       *  showing, so "why can Support see reports" has a visible answer. */
      isCustomised: (await loadOverrides()).has(role),
    })),
  );
}

/**
 * Replace what a role may reach.
 *
 * Takes the intended FINAL set rather than a diff: the matrix edits checkboxes,
 * and applying a diff computed against a stale page is how an area nobody
 * touched gets removed.
 */
export async function setRoleAreas(role: StaffRole, areas: string[], actorId: string) {
  if (isLockedRole(role)) {
    throw AppError.badRequest(
      'Owners and developers always keep full access and cannot be changed',
      { field: 'role' },
    );
  }

  const unknown = areas.filter((area) => !isArea(area));

  if (unknown.length > 0) {
    // Refused rather than filtered: silently dropping an unknown area would
    // save a set the owner did not choose and show it back as if they had.
    throw AppError.badRequest(`Unknown area: ${unknown.join(', ')}`, { field: 'areas' });
  }

  const before = await resolveAreas(role);
  const next = [...new Set(areas)] as Area[];

  await prisma.rolePermission.upsert({
    where: { role },
    create: { role, areas: next, updatedById: actorId },
    update: { areas: next, updatedById: actorId },
  });

  clearRolePermissionCache();

  return { before: [...before], after: next };
}

/**
 * Drop the override, returning the role to its shipped default.
 *
 * A real action rather than "tick everything back": the defaults change
 * between releases, and an owner who reset by hand today would be frozen at
 * whatever this version happened to grant.
 */
export async function resetRoleAreas(role: StaffRole) {
  if (isLockedRole(role)) {
    throw AppError.badRequest('Owners and developers have no override to reset', {
      field: 'role',
    });
  }

  const before = await resolveAreas(role);

  await prisma.rolePermission.deleteMany({ where: { role } });

  clearRolePermissionCache();

  return { before: [...before], after: [...areasFor(role)] };
}
