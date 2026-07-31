/**
 * Permission areas and role grants.
 *
 * ─── MUST MIRROR backend/src/config/roles.ts ─────────────────────────
 * Duplicated deliberately rather than fetched: the sidebar needs it during
 * the first render, and a network round-trip to decide which links to draw
 * would flash an empty nav on every page load.
 *
 * The COST of duplication is drift. That is acceptable ONLY because this copy
 * is advisory — it decides what to *show*. The API decides what is *allowed*,
 * and a stale copy here can never grant access, only mislabel a menu.
 *
 * If they drift, the symptom is a link that 403s. Never the reverse.
 */

export const AREAS = [
  'orders',
  'products',
  'inventory',
  'customers',
  'categories',
  'discounts',
  'reviews',
  'delivery',
  'returns',
  'reports',
  'settings',
  'staff',
] as const;

export type Area = (typeof AREAS)[number];

export type StaffRole =
  | 'DEVELOPER'
  | 'OWNER'
  | 'MANAGER'
  | 'FULFILLMENT'
  | 'SUPPORT'
  | 'DEMO';

const ALL = '*' as const;

const ROLE_AREAS: Record<StaffRole, readonly (typeof ALL | Area)[]> = {
  DEVELOPER: [ALL],
  OWNER: [ALL],
  MANAGER: [
    'orders',
    'products',
    'inventory',
    'customers',
    'categories',
    'discounts',
    'reviews',
    'delivery',
    'returns',
    'reports',
    'settings',
  ],
  FULFILLMENT: ['orders', 'delivery', 'inventory', 'products', 'returns'],
  SUPPORT: ['orders', 'customers', 'reviews', 'returns'],
  /**
   * Explicit list, NOT `ALL` — this drifted from the backend's real grant
   * (which excludes `staff` deliberately, see roles.ts on the API side) and
   * was corrected here to match. `ALL` would have shown DEMO a "Staff" link
   * that 403s the moment it's clicked — a courtesy failing, never a control:
   * the API already refused it either way.
   */
  DEMO: [
    'orders',
    'products',
    'inventory',
    'customers',
    'categories',
    'discounts',
    'reviews',
    'delivery',
    'returns',
    'reports',
    'settings',
  ],
};

export function canAccessArea(role: StaffRole, area: Area): boolean {
  const grants = ROLE_AREAS[role];
  return grants.includes(ALL) || grants.includes(area);
}

/** Roles that may never modify anything. Mirrors the backend's list. */
export function isReadOnlyRole(role: StaffRole): boolean {
  return role === 'DEMO';
}
