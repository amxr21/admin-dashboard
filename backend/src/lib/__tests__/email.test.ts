import { describe, expect, it } from 'vitest';

import { EMAIL_MAX_LENGTH, isEmailShaped } from '../email.js';

/**
 * The email shape check.
 *
 * This replaced `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which CodeQL flagged as a
 * polynomial ReDoS (js/polynomial-redos). The value comes straight off a
 * request body, so a crafted string could occupy the event loop — and Node is
 * single-threaded, so that stalls every other request on the instance.
 *
 * The behaviour tests keep it honest; the timing test is the one that would
 * fail if someone "simplified" it back to a regex.
 */

describe('accepts real addresses', () => {
  it.each([
    'a@b.co',
    'ammar@example.com',
    'first.last@sub.domain.co.uk',
    'user+tag@example.org',
    "o'brien@example.com",
    'ünïcode@example.com',
  ])('%s', (value) => {
    expect(isEmailShaped(value)).toBe(true);
  });
});

describe('rejects what a typo actually looks like', () => {
  it.each([
    ['', 'empty'],
    ['plainstring', 'no @'],
    ['@example.com', 'no local part'],
    ['user@', 'no domain'],
    ['user@localhost', 'no dot in the domain'],
    ['user@.com', 'dot leads the domain'],
    ['user@example.', 'dot trails the domain'],
    ['a@b@c.com', 'two @'],
    ['user name@example.com', 'space in the local part'],
    ['user@exa mple.com', 'space in the domain'],
    ['user@example.com\n', 'trailing newline'],
  ])('%s (%s)', (value) => {
    expect(isEmailShaped(value)).toBe(false);
  });

  it('rejects anything past the RFC length limit', () => {
    // Also the first line of defence: nothing long enough to be expensive
    // ever reaches the rest of the checks.
    const tooLong = `${'a'.repeat(EMAIL_MAX_LENGTH)}@example.com`;

    expect(tooLong.length).toBeGreaterThan(EMAIL_MAX_LENGTH);
    expect(isEmailShaped(tooLong)).toBe(false);
  });
});

describe('the ReDoS is actually gone', () => {
  it('stays fast on the input shape CodeQL named', () => {
    /**
     * CodeQL's report: *"may run slow on strings starting with '!@!.' and with
     * many repetitions of '!.'"*. Against the old regex the work grew with the
     * SQUARE of the length, because a literal `.` is also matched by `[^\s@]`,
     * so the engine tried every way of splitting the text around the dot.
     *
     * A linear scan has nothing to backtrack. The threshold is deliberately
     * loose — this is not a benchmark, it is a tripwire for reintroducing a
     * catastrophic pattern, which would blow past it by orders of magnitude.
     */
    const attack = `!@!.${'!.'.repeat(50_000)}`;

    const began = performance.now();
    const result = isEmailShaped(attack);
    const elapsed = performance.now() - began;

    // Rejected on length long before any scanning.
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it('stays fast even when the length guard cannot help', () => {
    // A string right at the limit, still all ambiguity. This is the case that
    // would hurt if the guard were the ONLY protection.
    const nearLimit = `!@!.${'!.'.repeat(120)}`.slice(0, EMAIL_MAX_LENGTH);

    const began = performance.now();
    isEmailShaped(nearLimit);
    const elapsed = performance.now() - began;

    expect(elapsed).toBeLessThan(50);
  });

  it('has no unbounded repetition left in it', () => {
    // The structural guarantee behind the timing tests: every regex in the
    // module is a single character class with no `+` or `*`, so there is
    // nothing for an engine to backtrack over.
    const source = isEmailShaped.toString();

    expect(source).not.toMatch(/\[\^[^\]]*\]\+/);
    expect(source).not.toMatch(/\)\+|\)\*/);
  });
});
