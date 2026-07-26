import { vi } from 'vitest';

/**
 * jsdom does not implement `window.matchMedia`, so anything reading a media
 * query throws in tests unless it's stubbed.
 *
 * This is a shared helper rather than a per-file mock so every test agrees on
 * the shape — a partial stub missing `addEventListener` produces a confusing
 * "not a function" several frames after mount.
 */

export interface MatchMediaController {
  /** Fire a preference change, as the OS would mid-session. */
  emit: (matches: boolean) => void;
  restore: () => void;
}

/**
 * Stub `window.matchMedia` so it reports `matches` for every query, and allow
 * tests to emit changes afterwards.
 */
export function mockMatchMedia(matches: boolean): MatchMediaController {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let current = matches;

  const original = window.matchMedia;

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return current;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    // Deprecated API, still stubbed — some libraries fall back to it.
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    emit(next: boolean) {
      current = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
    restore() {
      window.matchMedia = original;
      listeners.clear();
    },
  };
}
