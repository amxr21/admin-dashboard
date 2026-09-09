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
  /** Approving/rejecting a shift (O9.19) — deliberately separate from
   *  `staff`, which MANAGER does not hold. See roles.ts on the API side. */
  'shifts',
] as const;

export type Area = (typeof AREAS)[number];

export type StaffRole =
  | 'DEVELOPER'
  | 'OWNER'
  | 'MANAGER'
  | 'FULFILLMENT'
  | 'CASHIER'
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
    'shifts',
  ],
  FULFILLMENT: ['orders', 'delivery', 'inventory', 'products', 'returns'],
  /**
   * The till (O5.10). Mirrors the backend's grant exactly — this list is a
   * courtesy that hides links the API would refuse anyway, so drift here
   * shows a cashier a link that 403s on click.
   *
   * NOT `inventory`: a cashier reads stock through the scan and the product
   * list, but editing it is a different job. Requiring stock rights to sell a
   * coffee is the over-granting O4 exists to correct.
   */
  CASHIER: ['orders', 'returns', 'products'],
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

/**
 * Where each role lands after signing in (O3.2 / F5.4).
 *
 * ─── WHY THE DASHBOARD IS THE WRONG DEFAULT FOR MOST ROLES ───────────
 * `/admin` opens on a revenue chart. Revenue is the OWNER's question. A
 * FULFILLMENT user has no `reports` grant at all, so the first screen they
 * see on every login is one built to answer something they are not allowed
 * to ask — and their actual work (today's orders) is a click away behind a
 * sidebar they have to learn first.
 *
 * ─── FIXED IN CODE, NOT CONFIGURABLE ─────────────────────────────────
 * The owner's decision, 2026-09-08. Per-USER would need a preferences table
 * that does not exist and would take away central control of what a new hire
 * sees first; a Settings panel would be one setting per role for a choice
 * that has one sensible answer per role. Making it configurable later needs
 * no migration, so this is not a door that closes.
 *
 * ─── EVERY DESTINATION IS INSIDE THE ROLE'S OWN GRANT ────────────────
 * Guarded by a test rather than by care: landing somebody on a page their
 * role cannot open would replace a confusing first screen with a 403, which
 * is worse. `ROLE_AREAS` above is the authority, so the two cannot drift.
 */
export const ROLE_LANDING: Record<StaffRole, string> = {
  // Sees everything; the dashboard is genuinely their overview.
  DEVELOPER: '/admin',
  OWNER: '/admin',
  // Runs the business day to day and does hold `reports`.
  MANAGER: '/admin',
  // Picks, packs and dispatches. Today's orders IS the job.
  FULFILLMENT: '/admin/orders',
  // Stands at a till. The sale screen IS the job, not a dashboard.
  CASHIER: '/admin/pos',
  // Answers customers: returns and complaints, not revenue.
  SUPPORT: '/admin/returns',
  // A guided tour — the dashboard is the most representative first screen.
  DEMO: '/admin',
};

export function landingFor(role: StaffRole): string {
  return ROLE_LANDING[role] ?? '/admin';
}
