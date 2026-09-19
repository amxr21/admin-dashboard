/**
 * Business-type catalogue (URG-021).
 *
 * Replaces free text (`kind`), which had drifted to values like "cafe" and
 * "restaurant" with no agreed spelling or casing, so it could never be
 * grouped or reported on.
 *
 * ─── WHY A CODE LIST, NOT AN ENUM COLUMN ─────────────────────────────
 * `Business.kind` stays `VarChar(60)`. These codes are a curated catalogue
 * the owner expects to GROW (the ticket calls it "extensible"), and a Prisma
 * enum would make every addition a migration. The column already holds
 * arbitrary text, so widening the catalogue later costs nothing.
 *
 * ─── OTHER REQUIRES A NOTE ───────────────────────────────────────────
 * Same contract as the refund/cancellation reasons: a bare "Other" records
 * that the list was insufficient and nothing more. Requiring the note turns
 * the escape hatch into the signal that tells you what to add next.
 */

export const BUSINESS_TYPES = [
  'RESTAURANT',
  'CAFE',
  'BAKERY',
  'FOOD_TRUCK',
  'GROCERY',
  'SUPERMARKET',
  'PHARMACY',
  'CLOTHING',
  'ELECTRONICS',
  'FURNITURE',
  'JEWELLERY',
  'BOOKSTORE',
  'SALON',
  'BARBERSHOP',
  'SPA',
  'GYM',
  'LAUNDRY',
  'OTHER',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export function isBusinessType(value: string): value is BusinessType {
  return (BUSINESS_TYPES as readonly string[]).includes(value);
}

/**
 * Legacy free-text values map to a catalogue code where the intent is
 * unambiguous. Deliberately small and exact-match only: guessing at a value
 * nobody can interpret would silently relabel a real business, which is worse
 * than showing the owner their original text and asking them to pick.
 *
 * Anything absent here keeps its stored text and is surfaced for review the
 * next time that business is edited — never rewritten in place.
 */
const LEGACY_ALIASES: Record<string, BusinessType> = {
  cafe: 'CAFE',
  coffee: 'CAFE',
  'coffee shop': 'CAFE',
  restaurant: 'RESTAURANT',
  bakery: 'BAKERY',
  'food truck': 'FOOD_TRUCK',
  grocery: 'GROCERY',
  supermarket: 'SUPERMARKET',
  pharmacy: 'PHARMACY',
  clothing: 'CLOTHING',
  electronics: 'ELECTRONICS',
  furniture: 'FURNITURE',
  jewellery: 'JEWELLERY',
  jewelry: 'JEWELLERY',
  bookstore: 'BOOKSTORE',
  salon: 'SALON',
  barbershop: 'BARBERSHOP',
  barber: 'BARBERSHOP',
  spa: 'SPA',
  gym: 'GYM',
  laundry: 'LAUNDRY',
};

/**
 * Best-effort read of a stored `kind`.
 *
 * Returns the catalogue code when the stored value already IS one, or when it
 * matches a known legacy alias exactly. Returns `null` for anything else —
 * the caller shows the raw text with a "needs review" state rather than
 * pretending it mapped.
 */
export function toBusinessType(stored: string | null | undefined): BusinessType | null {
  if (!stored) return null;
  const trimmed = stored.trim();
  if (!trimmed) return null;
  if (isBusinessType(trimmed)) return trimmed;
  return LEGACY_ALIASES[trimmed.toLowerCase()] ?? null;
}
