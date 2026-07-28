/**
 * Email shape check with NO backtracking.
 *
 * ─── MIRRORS backend/src/lib/email.ts, DELIBERATELY ──────────────────
 * The two packages share no types package, so this is copied rather than
 * imported — the same arrangement as the money and date rules in
 * resource-form.tsx. Copied verbatim so they cannot drift: if this accepts
 * something the server rejects, the user gets a confusing round trip.
 *
 * ─── WHY IT IS NOT A REGEX ───────────────────────────────────────────
 * It used to be `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which CodeQL flagged on the
 * backend as a polynomial ReDoS: a literal `.` is also matched by `[^\s@]`, so
 * the engine has many ways to split the same text around the dot and tries all
 * of them on input that can never match.
 *
 * The severity is much lower here — the only input is what the person typed
 * into their own browser, so the worst case is freezing their own tab. But the
 * server-side rule changed, and these two are supposed to be identical. A
 * mirror that quietly diverges is worse than no mirror.
 */

/** RFC 5321 §4.5.3.1 — the longest an address may be in practice. */
export const EMAIL_MAX_LENGTH = 254;

export function isEmailShaped(value: string): boolean {
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return false;

  const at = value.indexOf('@');

  // Needs a local part before the @.
  if (at <= 0) return false;

  // Exactly one @.
  if (value.indexOf('@', at + 1) !== -1) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (domain.length === 0) return false;

  // A single-character class with no repetition cannot backtrack.
  if (/\s/.test(local) || /\s/.test(domain)) return false;

  const dot = domain.indexOf('.');

  // A dot that is neither first nor last: rejects "a@.com" and "a@com."
  // while accepting "a@b.co.uk".
  return dot > 0 && dot < domain.length - 1;
}
