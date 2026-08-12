'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * List-page state that lives in the URL instead of `useState`.
 *
 * The contract this exists to satisfy: paste the URL to a colleague and they
 * see the same screen, and the back button steps through what you actually
 * did. Holding filters in component state fails both — and it failed silently,
 * because a table with local state looks completely correct until someone
 * tries to share a link.
 *
 * Three tables previously READ a seed param (`?status=`, `?lowStock=`) via a
 * lazy `useState` initializer but never wrote back, so a deep link worked once
 * and then drifted out of sync the moment the user touched a control. That
 * half-measure is the thing this replaces; a seed-only param is arguably worse
 * than none, since the URL then actively lies about the current view.
 *
 * ## Why `router.replace`, not `push`
 *
 * Typing in a search box would otherwise push one history entry per debounced
 * keystroke, and "back" would walk the user backwards through their own
 * typing rather than to the previous page. Callers that genuinely want a new
 * history entry (a tab switch, say) can pass `{ history: 'push' }`.
 *
 * ## Why values are omitted rather than written as empty
 *
 * `?search=&status=all&page=1` is noise that makes every default-state URL
 * look filtered. A value equal to its default is deleted from the query
 * string, so the clean state produces a clean URL — which also makes
 * `hasActiveFilters` a simple key-count check for consumers.
 *
 * ## Scroll
 *
 * `scroll: false` on every navigation. These are same-page state updates; the
 * browser's default jump-to-top on navigate would yank the viewport whenever
 * someone changed a filter halfway down a long table.
 */

export interface UrlStateOptions {
  /** `push` adds a history entry; `replace` (default) does not. */
  history?: 'push' | 'replace';
}

/**
 * Read one query param with a default.
 *
 * The default is compared against on write, so passing the same default here
 * and at the call site keeps the URL clean automatically.
 */
export function useUrlParam(
  key: string,
  defaultValue = '',
): [string, (value: string, options?: UrlStateOptions) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string, options?: UrlStateOptions) => {
      const params = new URLSearchParams(searchParams.toString());

      if (next === defaultValue || next === '') params.delete(key);
      else params.set(key, next);

      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;

      if (options?.history === 'push') router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [key, defaultValue, searchParams, router, pathname],
  );

  return [value, setValue];
}

/**
 * Read and write several params at once.
 *
 * Necessary because the common interaction changes two things together:
 * applying a filter must also reset the page to 1. Doing that with two
 * separate `useUrlParam` writes races — both callbacks close over the same
 * `searchParams` snapshot, so the second overwrites the first and the page
 * number survives. Batching into one navigation is the only correct shape.
 *
 * A `null` value deletes the key, which is how callers clear a filter.
 */
export function useUrlState(defaults: Record<string, string> = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Serialised so the identity is stable across renders — `searchParams` is a
  // new object every render, which would otherwise re-fire every consumer's
  // `useCallback`/`useEffect` on each parent render.
  const serialised = searchParams.toString();

  const values = useMemo(() => {
    const params = new URLSearchParams(serialised);
    const result: Record<string, string> = { ...defaults };

    for (const [key, value] of params.entries()) result[key] = value;

    return result;
    // `defaults` is spread into a fresh object, so a caller passing an inline
    // literal cannot cause an infinite loop here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, JSON.stringify(defaults)]);

  const setValues = useCallback(
    (next: Record<string, string | null>, options?: UrlStateOptions) => {
      const params = new URLSearchParams(serialised);

      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '' || value === defaults[key]) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;

      if (options?.history === 'push') router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serialised, pathname, router, JSON.stringify(defaults)],
  );

  /** Drop every key this hook manages, leaving unrelated params untouched. */
  const clear = useCallback(
    (keys: readonly string[], options?: UrlStateOptions) => {
      const params = new URLSearchParams(serialised);
      for (const key of keys) params.delete(key);

      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;

      if (options?.history === 'push') router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [serialised, pathname, router],
  );

  return { values, setValues, clear };
}
