import { describe, expect, it } from 'vitest';

import { fillPlaceholders, QUARTER_HOURS, zonedToUtc } from '../campaign-content';

describe('campaign content helpers', () => {
  it('turns a Dubai local time into the right UTC instant', () => {
    expect(zonedToUtc('2026-10-01', '10:00', 'Asia/Dubai').toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('respects daylight saving on both sides of a change', () => {
    // London is UTC+1 in summer and UTC+0 in winter.
    expect(zonedToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });

  it('previews placeholders with the first name only', () => {
    expect(
      fillPlaceholders('Hi {{customer_name}} — {{discount_code}} {{other}}', {
        customerName: 'Mariam Ali',
        storeName: 'S',
        branchName: 'B',
        discountCode: 'EID',
      }),
    ).toBe('Hi Mariam — EID {{other}}');
  });

  it('offers every quarter hour of the day', () => {
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(QUARTER_HOURS[0]).toBe('00:00');
    expect(QUARTER_HOURS[95]).toBe('23:45');
  });
});