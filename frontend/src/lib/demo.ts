/**
 * Demo-seeded rows are tagged (`__demo__`, see `backend/prisma/demo-data.ts`)
 * so teardown can find and remove them with certainty. The tag is
 * DELIBERATELY ugly in a raw data view — a table dump should make it obvious
 * these rows aren't real customers.
 *
 * That reasoning doesn't extend to polished, glanceable dashboard widgets
 * (the fulfillment "needs attention" queue, the recent-activity feed): there,
 * a raw `__demo__-ORD-00109` reads as broken, not as a safety feature. This
 * strips the tag for DISPLAY ONLY — never use it on a value that flows back
 * to a query or a teardown match.
 */
const DEMO_TAG = '__demo__';

export function stripDemoTag<T extends string | null | undefined>(value: T): T {
  if (!value) return value;

  return value
    .replace(`${DEMO_TAG}-`, '')
    .replace(`@${DEMO_TAG}.invalid`, '') as T;
}
