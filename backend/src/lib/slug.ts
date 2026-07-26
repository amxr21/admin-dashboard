/**
 * Turn a display name into a URL-safe slug.
 *
 * Deterministic on purpose: the seed script uses the slug as an upsert key, so
 * the same input must always produce the same output or re-seeding would
 * create duplicates instead of updating.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
