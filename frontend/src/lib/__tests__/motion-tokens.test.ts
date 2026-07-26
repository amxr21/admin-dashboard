import { describe, expect, it } from 'vitest';

import {
  DISTANCE,
  DURATION,
  EASE,
  REDUCED,
  STAGGER,
  STAGGER_TOTAL_MAX,
} from '../motion-tokens';

/**
 * Tokens are the contract that keeps motion feeling like one system. These
 * tests pin the PROPERTIES that make them a usable scale, not the literal
 * numbers — a designer retuning `base` from 0.3 to 0.28 should not break the
 * suite, but making `fast` slower than `slow` should.
 */

describe('DURATION scale', () => {
  it('increases monotonically', () => {
    // If this ever inverts, "fast" and "slow" stop meaning anything and every
    // call site that picked one on intuition is now wrong.
    const scale = [
      DURATION.instant,
      DURATION.fast,
      DURATION.base,
      DURATION.slow,
      DURATION.slower,
    ];

    const sorted = [...scale].sort((a, b) => a - b);
    expect(scale).toEqual(sorted);
  });

  it('keeps every duration within a perceptually sensible range', () => {
    // Under ~80ms reads as an instant jump rather than a transition; over ~1s
    // in a dashboard reads as waiting.
    for (const value of Object.values(DURATION)) {
      expect(value).toBeGreaterThanOrEqual(0.08);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('DISTANCE scale', () => {
  it('increases monotonically', () => {
    const scale = [DISTANCE.sm, DISTANCE.md, DISTANCE.lg, DISTANCE.xl];
    expect(scale).toEqual([...scale].sort((a, b) => a - b));
  });

  it('stays subtle enough for a data-dense UI', () => {
    // Long travel in a table-heavy admin tool is actively distracting.
    expect(DISTANCE.xl).toBeLessThanOrEqual(80);
  });
});

describe('EASE tokens', () => {
  it('are all valid GSAP ease strings', () => {
    // A typo here fails silently: GSAP falls back to a default ease rather than
    // throwing, so the animation just feels subtly wrong with no error.
    const validPattern = /^(power[1-4]|back|expo|elastic|circ|sine|bounce|none)/;

    for (const [name, value] of Object.entries(EASE)) {
      expect(value, `EASE.${name}`).toMatch(validPattern);
    }
  });

  it('provides distinct in, out and inOut variants', () => {
    // Entering and leaving must not share an ease — decelerating on exit looks
    // like the element is reluctant to go.
    expect(EASE.out).not.toBe(EASE.in);
    expect(EASE.inOut).not.toBe(EASE.out);
  });

  it('exposes a linear option for continuous loops', () => {
    // Spinners must not ease, or they visibly stutter once per revolution.
    expect(EASE.none).toBe('none');
  });
});

describe('REDUCED motion token', () => {
  it('removes all travel', () => {
    // The entire point. Any non-zero value here reintroduces the vestibular
    // problem reduced motion exists to avoid.
    expect(REDUCED.distance).toBe(0);
  });

  it('still animates, rather than snapping', () => {
    // Reduced motion means no MOVEMENT, not no transition. A zero-duration pop
    // is harder to follow than a short fade.
    expect(REDUCED.duration).toBeGreaterThan(0);
  });

  it('is faster than the standard base duration', () => {
    expect(REDUCED.duration).toBeLessThan(DURATION.base);
  });
});

describe('STAGGER tokens', () => {
  it('increase monotonically', () => {
    const scale = [STAGGER.tight, STAGGER.base, STAGGER.loose];
    expect(scale).toEqual([...scale].sort((a, b) => a - b));
  });

  it('caps total stagger time so long lists do not crawl', () => {
    // 50 rows x 0.05s each is 2.5s of waiting. The cap is what makes
    // `stagger: { amount }` safe on a table of unknown length.
    expect(STAGGER_TOTAL_MAX).toBeLessThanOrEqual(0.6);
    expect(STAGGER_TOTAL_MAX).toBeGreaterThan(0);
  });
});
