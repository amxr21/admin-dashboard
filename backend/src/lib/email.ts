/**
 * Email shape check with NO backtracking.
 *
 * ─── WHY THIS IS NOT A REGEX ─────────────────────────────────────────
 * It used to be `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, and CodeQL flagged it as a
 * polynomial ReDoS (js/polynomial-redos, CWE-1333).
 *
 * The ambiguity is in the tail: `[^\s@]+\.[^\s@]+`. A literal `.` is ALSO
 * matched by `[^\s@]`, so the engine has many ways to split the same text
 * around the dot. Given input that can never match — say `a@` followed by
 * thousands of `!.` and no valid ending — it tries them all, and the work grows
 * with the square of the input length.
 *
 * That matters here specifically because this validates a value straight off a
 * REQUEST BODY. One 100 KB string in a field declared `email` is a cheap way to
 * occupy the event loop, and Node is single-threaded, so it stalls every other
 * request on that instance.
 *
 * A linear scan has no backtracking to exploit, and it states the rules plainly
 * rather than hiding them in punctuation.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────
 * It does not attempt RFC 5322. Full address grammar allows quoted local parts,
 * comments and bracketed IP literals, and a validator that rejects a real
 * address is worse than one that accepts an unusual one — the only proof an
 * address works is sending to it. This checks the shape that catches typos.
 */

/** RFC 5321 §4.5.3.1 — the longest an address may be in practice. */
export const EMAIL_MAX_LENGTH = 254;

export function isEmailShaped(value: string): boolean {
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return false;

  const at = value.indexOf('@');

  // Needs a local part before the @.
  if (at <= 0) return false;

  // Exactly one @ — indexOf from just past the first is O(n), not a scan of
  // every possible split.
  if (value.indexOf('@', at + 1) !== -1) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (domain.length === 0) return false;

  // No whitespace anywhere. A single-character class with no repetition cannot
  // backtrack, so this stays linear.
  if (/\s/.test(local) || /\s/.test(domain)) return false;

  const dot = domain.indexOf('.');

  // A dot that is neither the first nor the last character of the domain:
  // rejects "a@.com" and "a@com." while accepting "a@b.co.uk".
  return dot > 0 && dot < domain.length - 1;
}
