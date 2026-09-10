import { describe, expect, it, vi } from 'vitest';

import {
  beginLoadingActivity,
  getLoadingActivitySnapshot,
  subscribeToLoadingActivity,
  withLoadingActivity,
} from '@/lib/loading-activity';

describe('loading activity', () => {
  it('keeps the activity active until every concurrent task finishes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToLoadingActivity(listener);
    const finishFirst = beginLoadingActivity();
    const finishSecond = beginLoadingActivity();

    finishFirst();
    expect(getLoadingActivitySnapshot()).toBe(1);
    finishSecond();
    finishSecond();

    expect(getLoadingActivitySnapshot()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('always clears activity when the tracked task rejects', async () => {
    await expect(withLoadingActivity(async () => {
      throw new Error('failed');
    })).rejects.toThrow('failed');

    expect(getLoadingActivitySnapshot()).toBe(0);
  });
});
