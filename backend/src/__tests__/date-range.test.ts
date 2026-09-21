import { describe, expect, it } from 'vitest';

import {
  dateOnlyInTimeZone,
  optionalDateOnlyBounds,
  resolveDateOnlyRange,
  shiftDateOnly,
  timeZoneOffsetSegments,
  zonedStartOfDay,
} from '../lib/date-range.js';

describe('branch-local date-only ranges', () => {
  it('converts Dubai midnight to the preceding UTC evening', () => {
    expect(zonedStartOfDay('2026-09-20', 'Asia/Dubai').toISOString()).toBe(
      '2026-09-19T20:00:00.000Z',
    );
  });

  it('uses a half-open bound across a daylight-saving change', () => {
    const range = resolveDateOnlyRange('2026-03-08', '2026-03-08', 'America/New_York');
    expect(range.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(range.days).toBe(1);
  });

  it('does not reject the maximum calendar range because DST adds an hour', () => {
    expect(resolveDateOnlyRange('2025-11-02', '2025-11-02', 'America/New_York', 1).days).toBe(1);
  });

  it('rejects impossible dates instead of normalising them into another month', () => {
    expect(() => zonedStartOfDay('2026-02-30', 'UTC')).toThrow('valid calendar date');
  });

  it('makes an inclusive to date an exclusive next-midnight bound', () => {
    expect(optionalDateOnlyBounds(undefined, '2026-09-20', 'Asia/Dubai')?.lt?.toISOString()).toBe(
      '2026-09-20T20:00:00.000Z',
    );
  });

  it('derives the branch calendar date from the instant', () => {
    const instant = new Date('2026-09-20T21:30:00.000Z');
    expect(dateOnlyInTimeZone(instant, 'Asia/Dubai')).toBe('2026-09-21');
    expect(dateOnlyInTimeZone(instant, 'America/New_York')).toBe('2026-09-20');
  });

  it('clamps monthly calendar arithmetic instead of rolling into March', () => {
    expect(shiftDateOnly('2025-03-31', { months: -1 })).toBe('2025-02-28');
    expect(shiftDateOnly('2024-03-31', { months: -1 })).toBe('2024-02-29');
  });

  it('finds the daylight-saving offset transition for SQL bucketing', () => {
    const segments = timeZoneOffsetSegments(
      new Date('2026-03-07T00:00:00.000Z'),
      new Date('2026-03-10T00:00:00.000Z'),
      'America/New_York',
    );
    expect(segments).toEqual([
      { until: new Date('2026-03-08T07:00:00.000Z'), offsetMinutes: -300 },
      { until: null, offsetMinutes: -240 },
    ]);
  });
});
