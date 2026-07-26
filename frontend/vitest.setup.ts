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

/**
 * jsdom implements neither the Pointer Capture API nor `scrollIntoView`.
 *
 * Radix's Select (and any other primitive built on its popper) calls
 * `hasPointerCapture` while opening, and `scrollIntoView` when it focuses the
 * active item. Without these, every test that opens a Select dies with
 * `target.hasPointerCapture is not a function` — an error that points at the
 * test, not at the missing browser API.
 *
 * Global setup rather than per-test: the failure happens inside the library
 * during a user interaction, so there is no seam to mock at the call site.
 */
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

/**
 * jsdom does not implement `ResizeObserver`.
 *
 * Radix's popper (Select's dropdown, and anything else positioned against a
 * trigger) constructs one to track its anchor. Without it, merely RENDERING a
 * component containing a Select throws `ResizeObserver is not defined` — the
 * whole test file fails before a single assertion runs, and the message names
 * a browser API rather than the component under test.
 *
 * Same reasoning as the pointer stubs above: the construction happens inside
 * the library, so there is no seam to mock at the call site.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
