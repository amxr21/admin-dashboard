import { afterEach, describe, expect, it } from 'vitest';

import { defaultModeFor, readMode, writeMode } from '../dashboard-mode';

describe('dashboard mode', () => {
  afterEach(() => window.localStorage.clear());

  it('defaults a Home Business to Simple and every other business to Detailed', () => {
    expect(defaultModeFor('HOME_BUSINESS')).toBe('simple');
    expect(defaultModeFor('RESTAURANT')).toBe('detailed');
    expect(defaultModeFor('')).toBe('detailed');
  });

  it('remembers a chosen mode and ignores anything else stored', () => {
    expect(readMode()).toBeNull();
    writeMode('simple');
    expect(readMode()).toBe('simple');
    window.localStorage.setItem('dashboard.mode', 'fancy');
    expect(readMode()).toBeNull();
  });
});