import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { mockMatchMedia } from '@/test/match-media';
import { useIsMobileViewport } from '../useIsMobileViewport';

/**
 * Same contract as `useReducedMotion`: starts `false` (desktop) for the
 * SSR/first-paint case, corrects to the real value after mount. The default
 * matters beyond hydration here — this project's global test setup stubs
 * `matchMedia` to report no match for every query, and the hook is
 * deliberately built so that default resolves to desktop (see the file's own
 * comment on why the query is phrased as `max-width`, not `min-width`).
 */

afterEach(() => {
  mockMatchMedia(false).restore();
});

describe('default state', () => {
  it('starts false without a mocked matchMedia', () => {
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);
  });

  it('stays false under this project\'s global test-setup stub', async () => {
    // No explicit mock here — relies on vitest.setup.ts's default, the same
    // condition every OTHER table test runs under.
    const { result } = renderHook(() => useIsMobileViewport());
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe('reading the media query', () => {
  it('reports true when the mobile query matches', async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobileViewport());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reports false when the mobile query does not match', async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobileViewport());
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe('live changes', () => {
  it('updates when the viewport crosses the breakpoint after mount', async () => {
    const controller = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobileViewport());
    await waitFor(() => expect(result.current).toBe(false));

    controller.emit(true);

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('updates back when the viewport returns above the breakpoint', async () => {
    const controller = mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobileViewport());
    await waitFor(() => expect(result.current).toBe(true));

    controller.emit(false);

    await waitFor(() => expect(result.current).toBe(false));
  });
});
