import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useReportQuery } from '../useReportQuery';
import { ApiError } from '@/lib/api';

vi.mock('@/hooks/useTranslatedApiError', () => ({
  useTranslatedApiError: () => translateError,
}));
const translateError = () => 'Request failed';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('report requests', () => {
  it.each(['success', 'failure'] as const)('ignores an older %s after a newer range has loaded', async (outcome) => {
    const old = deferred<string>();
    const query = () => old.promise;
    const next = () => Promise.resolve('new range');
    const { result, rerender } = renderHook(({ query }) => useReportQuery(query), { initialProps: { query } });
    rerender({ query: next });
    await waitFor(() => expect(result.current.data).toBe('new range'));
    await act(async () => {
      if (outcome === 'success') old.resolve('old range');
      else old.reject(new Error('old failure'));
      await old.promise.catch(() => undefined);
    });
    expect(result.current.data).toBe('new range');
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps loading while the current request is pending even if an old one finishes', async () => {
    const old = deferred<string>();
    const next = deferred<string>();
    const { result, rerender } = renderHook(({ query }) => useReportQuery(query), {
      initialProps: { query: () => old.promise },
    });
    rerender({ query: () => next.promise });
    await act(async () => { old.resolve('old'); await old.promise; });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    await act(async () => { next.resolve('current'); await next.promise; });
    expect(result.current.data).toBe('current');
  });

  it('clears stale data on failure, explains invalid ranges, and supports retry', async () => {
    const query = vi.fn<() => Promise<string>>().mockResolvedValue('original');
    const { result } = renderHook(() => useReportQuery(query));
    await waitFor(() => expect(result.current.data).toBe('original'));
    query.mockRejectedValueOnce(new ApiError(400, 'BAD_REQUEST', 'Choose a range of 731 days or fewer'));
    await act(() => result.current.load());
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Choose a range of 731 days or fewer');
    await act(() => result.current.load());
    expect(result.current.data).toBe('original');
    expect(result.current.error).toBeNull();
  });
});
