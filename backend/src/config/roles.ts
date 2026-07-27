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
  /**
   * Sees the product, changes nothing — but NOT `staff`.
   *
   * ─── WHY THIS IS AN EXPLICIT LIST AND NOT `ALL` ──────────────────────
   * It used to be `[ALL]`, on the reasoning "sees everything, changes
   * nothing". Read-only was enforced, so nothing could be broken — but the
   * demo account exists to be handed to PROSPECTIVE CLIENTS, and `staff`
   * returns real employees: names, email addresses, who is locked out, when
   * each person last signed in.
   *
   * Nothing was writable, so no check failed. It was a privacy leak, not an
   * authorisation bug, which is exactly why a write-focused rule missed it.
   *
   * Listed explicitly rather than `ALL` minus one, so a NEW area is not
   * granted to demo accounts by default. A future area holding personal data
   * has to be added here deliberately.
   */
  [StaffRole.DEMO]: [
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

/**
 * Privilege ORDER, highest first. Separate from `ROLE_AREAS` on purpose.
 *
 * ─── WHY AREAS ARE NOT A HIERARCHY ───────────────────────────────────
 * `ROLE_AREAS` answers "may this role open this screen". It deliberately does
 * NOT imply rank: DEMO reaches every area and outranks nobody, while
 * FULFILLMENT reaches four areas and outranks nobody either. Deriving rank by
 * counting areas would make DEMO the most powerful role in the system.
 *
 * Rank is only used for one question — who may change whose role — so it is
 * declared explicitly rather than inferred.
 */
const ROLE_ORDER: readonly StaffRole[] = [
  StaffRole.DEVELOPER,
  StaffRole.OWNER,
  StaffRole.MANAGER,
  StaffRole.FULFILLMENT,
  StaffRole.SUPPORT,
  StaffRole.DEMO,
];

/** Lower number = more privileged. */
export function rankOf(role: StaffRole): number {
  const index = ROLE_ORDER.indexOf(role);
  // An unlisted role is treated as the LEAST privileged rather than the most.
  // If someone adds a role to the enum and forgets this list, the safe failure
  // is "cannot do anything", not "outranks everyone".
  return index === -1 ? ROLE_ORDER.length : index;
}

/** Does the actor outrank the subject? Equal rank is NOT outranking. */
export function outranks(actor: StaffRole, subject: StaffRole): boolean {
  return rankOf(actor) < rankOf(subject);
}

/**
 * May this actor grant this role?
 *
 * At or below their own rank. An OWNER may create another OWNER — otherwise
 * only a DEVELOPER could, and a business would be one deleted account away
 * from having nobody who can hire.
 *
 * Granting ABOVE your own rank is privilege escalation, which is the single
 * most valuable thing to get wrong in a staff screen.
 */
export function canAssignRole(actor: StaffRole, target: StaffRole): boolean {
  return rankOf(target) >= rankOf(actor);
}
