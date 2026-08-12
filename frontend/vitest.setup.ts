import { createElement, type ReactNode } from 'react';
import { vi } from 'vitest';

import '@testing-library/jest-dom/vitest';

/**
 * Default stub for the locale-aware navigation primitives.
 *
 * Fifteen test files each hand-rolled a PARTIAL mock of this module —
 * typically `Link` alone. That works right up until a component starts using
 * another primitive from it, at which point every one of those files fails
 * with "No `useRouter` export is defined on the mock", naming the mock rather
 * than the change that caused it. Adding URL-backed table state broke 18
 * tests across the suite that way, none of which were testing navigation.
 *
 * Declaring the whole surface once, here, means a component adopting
 * `useRouter` or `usePathname` doesn't break unrelated suites. A test that
 * cares about navigation still overrides this with its own `vi.mock`, which
 * takes precedence over a setup-file default.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));

/**
 * Default stub for `next/navigation`.
 *
 * next-intl's navigation module resolves this in a way Vitest cannot follow,
 * and `useSearchParams` is now read by any list page holding its state in the
 * URL. Defaults to an empty query string — the same view as opening the page
 * with no filters applied. A test that needs real params overrides this
 * locally.
 */
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
}));

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
