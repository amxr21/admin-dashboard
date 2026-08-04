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

/**
 * `OnboardingWelcome` (mounted unconditionally in `AppShell`) opens by
 * default the first time a browser has no "seen" flag in localStorage —
 * which is EVERY jsdom test run, since each one starts with empty storage.
 * Left alone, every test that renders `AppShell` gets a modal dialog open
 * on top of the sidebar it's actually trying to assert against: Radix marks
 * the rest of the tree `aria-hidden` while its dialog is open, so
 * `getByRole('link', ...)` for a nav item finds nothing — the accessible
 * tree contains only the dialog.
 *
 * Seeding the flag here (global setup, not a per-test `beforeEach`) means
 * the shell renders as an already-onboarded browser by default, which is
 * what nearly every existing test actually wants to assert against. A test
 * FOR the onboarding overlay itself should clear this key locally rather
 * than relying on the global default.
 */
if (typeof window !== 'undefined') {
  window.localStorage.setItem('admin-dashboard:onboarding-welcome-seen', 'true');
}
