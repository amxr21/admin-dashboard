import { describe, expect, it } from 'vitest';

import { toLocalCalendarDate } from '@/lib/calendar-date';

describe('toLocalCalendarDate', () => {
  it('uses local calendar parts instead of converting through UTC', () => {
    expect(toLocalCalendarDate(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07');
  });
});
