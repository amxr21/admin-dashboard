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
    'reports',
    'settings',
  ],
  FULFILLMENT: ['orders', 'delivery', 'inventory', 'products'],
  SUPPORT: ['orders', 'customers', 'reviews'],
  // Sees everything; writes are blocked server-side at a middleware choke
  // point, not by hiding UI.
  DEMO: [ALL],
};

export function canAccessArea(role: StaffRole, area: Area): boolean {
  const grants = ROLE_AREAS[role];
  return grants.includes(ALL) || grants.includes(area);
}

/** Roles that may never modify anything. Mirrors the backend's list. */
export function isReadOnlyRole(role: StaffRole): boolean {
  return role === 'DEMO';
}
