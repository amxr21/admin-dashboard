import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement `window.matchMedia`.
 *
 * This stub has to be installed HERE, in global setup, rather than in a
 * `beforeEach`. GSAP reads `matchMedia` at module-import time, so any test file
 * importing `@/lib/gsap` crashes with `_win.matchMedia is not a function`
 * before a per-test mock would ever run.
 *
 * Defaults to "no preference" — the common case. Tests that care about the
 * preference override this with `mockMatchMedia()` from `src/test/match-media`.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
