import { describe, expect, it } from 'vitest';

import {
  ORDER_REFERENCE_ALPHABET,
  randomReference,
} from '../services/storefront.service.js';

/**
 * The random half of an order reference (`ORD-1024-K7M2XP`).
 *
 * This is a SECURITY control, not cosmetics: the public tracking endpoint takes
 * an order reference, so a predictable one would let anyone enumerate the table
 * and read every customer's name, phone and address. These assertions pin the
 * properties that make enumeration infeasible.
 *
 * No database required — pure generation logic, so it runs in CI without the
 * MySQL service container.
 */

describe('order reference generation', () => {
  it('is the expected length', () => {
    expect(randomReference()).toHaveLength(6);
  });

  it('uses only characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of randomReference()) {
        expect(ORDER_REFERENCE_ALPHABET).toContain(char);
      }
    }
  });

  it('excludes glyphs that get misread down a phone line', () => {
    // A customer reads this reference aloud to support. I/1, O/0 and L/1 are
    // the classic confusions; U is excluded to avoid accidental profanity.
    for (const char of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(ORDER_REFERENCE_ALPHABET).not.toContain(char);
    }
  });

  it('does not repeat across many draws', () => {
    // 30^6 ≈ 729M possibilities, so 1,000 draws colliding would mean the
    // generator is not actually random — the exact failure that would make
    // references guessable.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(randomReference());
    }

    expect(seen.size).toBe(1000);
  });

  it('uses the whole alphabet, not a biased subset', () => {
    // A broken generator (a bad modulo, an off-by-one bound) typically still
    // produces varied-looking output while never emitting the first or last
    // character. Sampling enough draws should reach every symbol.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      for (const char of randomReference()) seen.add(char);
    }

    expect(seen.size).toBe(ORDER_REFERENCE_ALPHABET.length);
  });
});
