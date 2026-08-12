import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useUrlState } from '../useUrlState';

/**
 * List-page state that lives in the URL.
 *
 * What matters is the CONTRACT the list pages depend on, not the mechanics:
 * a value equal to its default never reaches the query string (so a clean view
 * has a clean URL), several values write in ONE navigation (so applying a
 * filter can reset the page without the two clobbering each other), and
 * navigation replaces rather than pushes (so a debounced search box doesn't
 * bury the previous page under one history entry per keystroke).
 */

const replace = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const currentParams = vi.hoisted(() => ({ value: new URLSearchParams() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/admin/r/products',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams.value,
}));

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  currentParams.value = new URLSearchParams();
});

describe('reading', () => {
  it('falls back to the declared default when the param is absent', () => {
    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    expect(result.current.values.page).toBe('1');
    expect(result.current.values.search).toBe('');
  });

  it('prefers the URL over the default', () => {
    currentParams.value = new URLSearchParams('page=3&search=lamp');

    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    expect(result.current.values.page).toBe('3');
    expect(result.current.values.search).toBe('lamp');
  });

  it('surfaces params the caller never declared a default for', () => {
    // Filter keys are namespaced (`f_status`) and discovered at runtime from
    // the resource schema, so they can't all be declared up front.
    currentParams.value = new URLSearchParams('f_status=ARCHIVED');

    const { result } = renderHook(() => useUrlState({ page: '1' }));

    expect(result.current.values.f_status).toBe('ARCHIVED');
  });
});

describe('writing', () => {
  it('omits a value equal to its default rather than writing it', () => {
    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    act(() => {
      result.current.setValues({ page: '1' });
    });

    // Not `?page=1` — a default-state URL must look unfiltered.
    expect(replace).toHaveBeenCalledWith('/admin/r/products', { scroll: false });
  });

  it('writes a non-default value', () => {
    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    act(() => {
      result.current.setValues({ page: '4' });
    });

    expect(replace).toHaveBeenCalledWith('/admin/r/products?page=4', {
      scroll: false,
    });
  });

  it('deletes a key when passed null', () => {
    currentParams.value = new URLSearchParams('search=lamp&page=2');

    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    act(() => {
      result.current.setValues({ search: null });
    });

    expect(replace).toHaveBeenCalledWith('/admin/r/products?page=2', {
      scroll: false,
    });
  });

  it('applies several changes in ONE navigation', () => {
    // The reason `setValues` takes an object at all. Two separate writes would
    // each read the same `searchParams` snapshot, so the second would clobber
    // the first — and the page number would survive a new search.
    currentParams.value = new URLSearchParams('page=7');

    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    act(() => {
      result.current.setValues({ search: 'chair', page: null });
    });

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/admin/r/products?search=chair', {
      scroll: false,
    });
  });

  it('leaves unrelated params untouched', () => {
    currentParams.value = new URLSearchParams('search=lamp&highlight=abc');

    const { result } = renderHook(() => useUrlState({ search: '' }));

    act(() => {
      result.current.setValues({ search: 'chair' });
    });

    const [href] = replace.mock.calls[0] as [string];
    expect(href).toContain('highlight=abc');
  });

  it('pushes a history entry only when asked', () => {
    const { result } = renderHook(() => useUrlState({ page: '1' }));

    act(() => {
      result.current.setValues({ page: '2' }, { history: 'push' });
    });

    expect(push).toHaveBeenCalledWith('/admin/r/products?page=2', {
      scroll: false,
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('never scrolls to top', () => {
    // These are same-page state updates. The browser's default jump-to-top
    // would yank the viewport whenever someone filtered halfway down a table.
    const { result } = renderHook(() => useUrlState({ page: '1' }));

    act(() => {
      result.current.setValues({ page: '2' });
    });

    expect(replace).toHaveBeenCalledWith(expect.any(String), { scroll: false });
  });
});

describe('clear', () => {
  it('drops only the named keys', () => {
    currentParams.value = new URLSearchParams(
      'search=lamp&f_status=ACTIVE&page=3&highlight=abc',
    );

    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    act(() => {
      result.current.clear(['search', 'f_status', 'page']);
    });

    const [href] = replace.mock.calls[0] as [string];
    expect(href).toBe('/admin/r/products?highlight=abc');
  });

  it('produces a bare path when nothing is left', () => {
    currentParams.value = new URLSearchParams('search=lamp&page=3');

    const { result } = renderHook(() => useUrlState({ page: '1', search: '' }));

    act(() => {
      result.current.clear(['search', 'page']);
    });

    // No trailing "?" — that would be a visible artefact in the address bar.
    expect(replace).toHaveBeenCalledWith('/admin/r/products', { scroll: false });
  });
});
