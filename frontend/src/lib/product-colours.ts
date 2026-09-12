/**
 * Curated colour names offered when a product opts into colours (URG-030).
 *
 * ─── A COLOUR IS A VARIANT NAME, NOT A NEW DIMENSION ─────────────────
 * Per the owner's decision: a colour IS a variant. "Red" becomes an ordinary
 * `ProductVariant` with its own SKU, price and stock, which is how a till
 * actually sells one — scan the red shirt, sell the red shirt. There is no
 * `colour` column, no size × colour matrix, and no migration, so nothing new
 * can drift out of sync with the variant rows that already carry the stock.
 *
 * `Product.hasColors` therefore controls one thing only: whether this list is
 * SUGGESTED while naming a variant. It never constrains what can be typed.
 *
 * ─── SUGGESTIONS, NOT A CLOSED LIST ──────────────────────────────────
 * These are offered, never enforced. A variant name is free text on the
 * server, and a shop selling "Burnt Orange" must be able to record it — so
 * the catalogue exists to make the COMMON case consistent ("Navy" rather than
 * "navy"/"dark blue"/"NAVY"), not to refuse the unusual one. That is why
 * there is no `isProductColour` type guard here: nothing validates against
 * this list, so a guard would imply a rule that does not exist.
 *
 * Contrast `business-types.ts`, which DOES carry a guard and an `OTHER` code:
 * `Business.kind` is a single stored code the server checks for membership,
 * so an escape hatch has to be an explicit member of the catalogue. A variant
 * name has no such contract — typing an unlisted colour IS the escape hatch,
 * which is why `OTHER` would be meaningless here (nobody names a variant
 * "Other") and is deliberately absent.
 *
 * Ordered by how often a small shop reaches for them — neutrals first, then
 * primaries — because these render as a suggestion list where order is the
 * only affordance for "start here".
 */

export const PRODUCT_COLOURS = [
  'Black',
  'White',
  'Grey',
  'Beige',
  'Brown',
  'Navy',
  'Blue',
  'Red',
  'Green',
  'Yellow',
  'Orange',
  'Pink',
  'Purple',
  'Gold',
  'Silver',
  'Multicolour',
] as const;

export type ProductColour = (typeof PRODUCT_COLOURS)[number];
