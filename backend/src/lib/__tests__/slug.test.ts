import { describe, expect, it } from 'vitest';
import { slugify } from '../slug.js';

/**
 * slugify is an upsert key in prisma/seed.ts — if it ever stops being
 * deterministic, re-seeding silently creates duplicate categories instead of
 * updating the existing ones.
 */
describe('slugify', () => {
  it('lowercases and hyphenates a normal name', () => {
    expect(slugify('Home & Garden')).toBe('home-garden');
  });

  it('collapses runs of separators into a single hyphen', () => {
    expect(slugify('Toys   &&&   Games')).toBe('toys-games');
  });

  it('trims leading and trailing hyphens', () => {
    // Without the trim, "  Electronics  " yields "-electronics-", which reads
    // as a different key and breaks the upsert.
    expect(slugify('  Electronics  ')).toBe('electronics');
  });

  it('is idempotent — slugifying a slug returns the same slug', () => {
    const once = slugify('Home & Garden');
    expect(slugify(once)).toBe(once);
  });

  it('is deterministic across calls', () => {
    expect(slugify('Apparel')).toBe(slugify('Apparel'));
  });

  it('returns an empty string when nothing survives normalisation', () => {
    // Callers must handle this: an empty slug would collide on the unique
    // index the moment a second such name appears.
    expect(slugify('!!!')).toBe('');
  });
});
