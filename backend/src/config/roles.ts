import { StaffRole } from '@prisma/client';

/**
 * Role → permission-area map. THE single source of truth for authorisation.
 *
 * The API enforces this. The UI only mirrors it — hiding a button is a
 * courtesy, never a control, because anyone can call the endpoint directly.
 *
 * Adding a resource: add its area here first, then reference it from the route
 * with `requireArea()`. A route without `requireArea` is unprotected, so the
 * area list existing first makes the omission obvious in review.
 */

/** Every permission area in the system. */
export const AREAS = [
  'orders',
  'products',
  'inventory',
  'customers',
  'categories',
  'discounts',
  'reviews',
  'delivery',
  'reports',
  'settings',
  'staff',
] as const;

export type Area = (typeof AREAS)[number];

/** Grants every area, including ones added later. */
const ALL = '*' as const;

type Grant = typeof ALL | Area;

/**
 * Which areas each role can reach.
 *
 * NOTE: this governs ACCESS, not whether writes are allowed. DEMO reaches
 * every area but is blocked from writing by a separate method-based check —
 * see `isReadOnlyRole` and middleware/authorize.ts. Keeping those two concerns
 * apart means a new resource is automatically read-only for demo users without
 * anyone remembering to configure it.
 */
export const ROLE_AREAS: Record<StaffRole, readonly Grant[]> = {
  // Full access plus developer-only diagnostics surfaces.
  [StaffRole.DEVELOPER]: [ALL],
  [StaffRole.OWNER]: [ALL],
  // Everything except staff management — hiring and access control stay with
  // the owner.
  [StaffRole.MANAGER]: [
    'orders',
    'products',
    'inventory',
    'customers',
    'categories',
    'discounts',
    'reviews',
    'delivery',
    'reports',
    'settings',
  ],
  [StaffRole.FULFILLMENT]: ['orders', 'delivery', 'inventory', 'products'],
  [StaffRole.SUPPORT]: ['orders', 'customers', 'reviews'],
  // Sees everything, changes nothing.
  [StaffRole.DEMO]: [ALL],
};

/** Human-readable labels, served to the UI so it never hardcodes its own. */
export const ROLE_LABELS: Record<StaffRole, string> = {
  [StaffRole.DEVELOPER]: 'Developer',
  [StaffRole.OWNER]: 'Owner',
  [StaffRole.MANAGER]: 'Manager',
  [StaffRole.FULFILLMENT]: 'Fulfillment',
  [StaffRole.SUPPORT]: 'Support',
  [StaffRole.DEMO]: 'Demo (read-only)',
};

/**
 * Roles that may never modify anything.
 *
 * An array rather than a single value so adding e.g. an auditor role later is
 * a one-line change instead of a refactor of every write path.
 */
const READ_ONLY_ROLES: readonly StaffRole[] = [StaffRole.DEMO];

export function isReadOnlyRole(role: StaffRole): boolean {
  return READ_ONLY_ROLES.includes(role);
}

/** Can this role reach this area at all? */
export function canAccessArea(role: StaffRole, area: Area): boolean {
  const grants = ROLE_AREAS[role];
  return grants.includes(ALL) || grants.includes(area);
}

/** Expanded area list for a role — used by GET /roles so the UI can mirror it. */
export function areasFor(role: StaffRole): readonly Area[] {
  return ROLE_AREAS[role].includes(ALL) ? AREAS : (ROLE_AREAS[role] as readonly Area[]);
}
