import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DASHBOARD_COMPARISON,
  parseDashboardState,
  rangeToDashboardParams,
} from '@/lib/dashboard-state';
import { defaultRange } from '@/lib/reports-api';

describe('dashboard URL state', () => {
  it('uses clean defaults when no dashboard parameters are supplied', () => {
    expect(parseDashboardState({})).toEqual({
      range: defaultRange(),
      comparison: DEFAULT_DASHBOARD_COMPARISON,
      needsNormalization: false,
    });
  });

  it('restores a valid custom range and comparison from a shared URL', () => {
    expect(
      parseDashboardState({ from: '2026-08-01', to: '2026-08-31', comparison: 'sameLastYear' }),
    ).toEqual({
      range: { from: '2026-08-01', to: '2026-08-31' },
      comparison: 'sameLastYear',
      needsNormalization: false,
    });
  });

  it.each([
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-09-10', to: '2026-09-01' },
    { from: '2024-01-01', to: '2026-09-01' },
    { from: '2026-09-01' },
  ])('falls back and requests normalization for an invalid range', (values) => {
    expect(parseDashboardState(values)).toMatchObject({
      range: defaultRange(),
      needsNormalization: true,
    });
  });

  it('normalizes an unsupported comparison', () => {
    expect(parseDashboardState({ comparison: 'weekly' })).toMatchObject({
      comparison: DEFAULT_DASHBOARD_COMPARISON,
      needsNormalization: true,
    });
  });

  it('omits the moving default range but keeps a custom range', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 12));

    expect(rangeToDashboardParams(defaultRange())).toEqual({ from: null, to: null });
    expect(rangeToDashboardParams({ from: '2026-08-01', to: '2026-08-31' })).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });

    vi.useRealTimers();
  });
});
