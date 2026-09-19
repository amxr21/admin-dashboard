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

/**
 * A slug that is free, resolving collisions with a numeric suffix (URG-027).
 *
 * ─── WHY THE CALLER PASSES THE LOOKUP ────────────────────────────────
 * Product and Category both need this against different tables, and both
 * columns are `@unique`. Passing `isTaken` keeps this helper free of Prisma
 * and lets each caller scope the check however it must.
 *
 * ─── WHY A SUFFIX AND NOT A RANDOM STRING ────────────────────────────
 * `blue-mug-2` is a slug a human can read back and recognise. A hash suffix
 * would also be unique and would tell nobody anything.
 *
 * ─── THIS IS NOT A RESERVATION ───────────────────────────────────────
 * Two simultaneous creates of the same name can both see the same slug free
 * and both take it. The `@unique` constraint is what actually prevents the
 * duplicate — the loser gets a translated 409 from `translateWriteError`,
 * the same way any other unique clash surfaces. Checking first only stops the
 * overwhelmingly common single-writer case from needing a retry, and a check
 * that RAN cannot make the constraint redundant (URG-005's lesson: a
 * check-then-write on a shared value is a race unless the check is the write).
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  { limit = 50 }: { limit?: number } = {},
): Promise<string> {
  const root = slugify(base);
  // An all-punctuation name slugifies to an empty string, which would be a
  // silently broken URL. The caller decides what to do with an empty root.
  if (!root) return '';

  if (!(await isTaken(root))) return root;

  for (let suffix = 2; suffix <= limit; suffix += 1) {
    const candidate = `${root}-${String(suffix)}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // Past the limit, stop guessing and let the unique constraint speak. Looping
  // forever on a pathological catalogue would turn one create into a hang.
  return `${root}-${String(Date.now())}`;
}
