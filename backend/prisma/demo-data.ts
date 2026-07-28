/**
 * Shared contract between the demo seeder and its teardown.
 *
 * ─── WHY A TAG AND NOT A DATE RANGE ──────────────────────────────────
 * Teardown has to be able to answer "did I create this?" with certainty. A
 * heuristic — anything created before X, anything that looks generated — will
 * eventually delete something real, and the person running it will not find
 * out until they need the row.
 *
 * So every demo row carries the tag in a field that is already unique or
 * indexed, and teardown matches on THAT and nothing else. If a row does not
 * carry the tag, teardown does not touch it, even if it looks identical to
 * something the seeder makes.
 *
 * The tag is deliberately ugly. It should never be mistaken for real content,
 * and it should be obvious in a table dump that these rows are not customers.
 */

export const DEMO_TAG = '__demo__';

/** Prefixes, so a human scanning a table can see what is demo at a glance. */
export const DEMO = {
  /** Products: `sku` is unique and indexed. */
  sku: (n: number) => `${DEMO_TAG}-SKU-${String(n).padStart(4, '0')}`,
  /** Orders: `orderNumber` is unique. */
  orderNumber: (n: number) => `${DEMO_TAG}-ORD-${String(n).padStart(5, '0')}`,
  /** Customers and couriers: email is the natural handle. */
  email: (slug: string) => `${slug}@${DEMO_TAG}.invalid`,
  /** Categories: `slug` is unique. */
  categorySlug: (slug: string) => `${DEMO_TAG}-${slug}`,
  /** Discounts: `code` is unique. */
  discountCode: (code: string) => `${DEMO_TAG}-${code}`,
} as const;

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve.
 *
 * If a notification or password-reset feature is ever wired up and someone
 * runs it against demo data, nothing can be delivered to a real inbox by
 * accident.
 */
export const DEMO_EMAIL_DOMAIN = `${DEMO_TAG}.invalid`;

/**
 * Deterministic pseudo-random.
 *
 * Seeded so two runs produce the SAME data. A demo that reshuffles every time
 * makes screenshots, review and "did that number change because of my code?"
 * all impossible to reason about.
 */
export function makeRandom(seed: number) {
  let state = seed >>> 0;

  return {
    /** [0, 1) */
    next(): number {
      // xorshift32 — small, fast, and good enough to look organic.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) % 1_000_000) / 1_000_000;
    },
    int(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(this.next() * items.length)] as T;
    },
    /** True with the given probability. */
    chance(probability: number): boolean {
      return this.next() < probability;
    },
  };
}
