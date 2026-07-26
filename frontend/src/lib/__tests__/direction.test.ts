import { afterEach, describe, expect, it } from 'vitest';

import { directionSign, getDocumentDirection, inlineOffset } from '../direction';

/**
 * CSS transforms ignore `dir="rtl"`. These functions are the only thing
 * preventing every x-axis animation from playing backwards in Arabic — a
 * failure that produces no error, just content sliding in from the wrong edge
 * or off-screen entirely.
 */

afterEach(() => {
  document.documentElement.dir = '';
});

describe('getDocumentDirection', () => {
  it('reads rtl from the document', () => {
    document.documentElement.dir = 'rtl';
    expect(getDocumentDirection()).toBe('rtl');
  });

  it('reads ltr from the document', () => {
    document.documentElement.dir = 'ltr';
    expect(getDocumentDirection()).toBe('ltr');
  });

  it('defaults to ltr when dir is unset', () => {
    document.documentElement.removeAttribute('dir');
    expect(getDocumentDirection()).toBe('ltr');
  });
});

describe('directionSign', () => {
  it('is 1 in LTR', () => {
    document.documentElement.dir = 'ltr';
    expect(directionSign()).toBe(1);
  });

  it('is -1 in RTL', () => {
    // The whole mechanism. If this returns 1 in RTL, every animated x-offset
    // travels the wrong way.
    document.documentElement.dir = 'rtl';
    expect(directionSign()).toBe(-1);
  });
});

describe('inlineOffset', () => {
  it('mirrors the start edge between directions', () => {
    document.documentElement.dir = 'ltr';
    const ltr = inlineOffset('start', 32);

    document.documentElement.dir = 'rtl';
    const rtl = inlineOffset('start', 32);

    // Same logical intent, opposite physical offsets.
    expect(ltr).toBe(32);
    expect(rtl).toBe(-32);
    expect(ltr).toBe(-rtl);
  });

  it('mirrors the end edge between directions', () => {
    document.documentElement.dir = 'ltr';
    const ltr = inlineOffset('end', 32);

    document.documentElement.dir = 'rtl';
    const rtl = inlineOffset('end', 32);

    expect(ltr).toBe(-32);
    expect(rtl).toBe(32);
  });

  it('keeps start and end on opposite sides in both directions', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      document.documentElement.dir = dir;
      const start = inlineOffset('start', 20);
      const end = inlineOffset('end', 20);

      expect(Math.sign(start), dir).not.toBe(Math.sign(end));
    }
  });

  it('handles a zero distance without producing -0', () => {
    // -0 is a valid number but surprises equality checks and serialises oddly.
    document.documentElement.dir = 'rtl';
    expect(Object.is(inlineOffset('start', 0), -0)).toBe(false);
  });
});
