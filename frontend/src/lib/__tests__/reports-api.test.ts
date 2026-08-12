import { describe, expect, it } from 'vitest';

import { drillDownHref } from '../reports-api';

/**
 * `drillDownHref` (C1.6) — the date arithmetic behind a chart-point click.
 * Extracted out of `RevenueChart` specifically so this is testable: Recharts
 * renders its interactive surface as SVG sized by a real layout engine,
 * which jsdom cannot simulate meaningfully, so the component itself has no
 * reliable way to exercise a click in a test. The arithmetic is what
 * actually needs pinning — getting the day off by one silently points a
 * "view these orders" link at the wrong day's orders.
 */

describe('day granularity', () => {
  it('scopes to exactly the clicked day', () => {
    expect(drillDownHref('2026-07-15', 'day')).toBe('/admin/orders?from=2026-07-15&to=2026-07-15');
  });
});

describe('week granularity', () => {
  it('scopes to the full 7-day bucket, inclusive end', () => {
    // bucketEnd adds 7 days (exclusive); the inclusive `to` is one day
    // before that, i.e. day 6 of the bucket.
    expect(drillDownHref('2026-07-13', 'week')).toBe('/admin/orders?from=2026-07-13&to=2026-07-19');
  });
});

describe('month granularity', () => {
  it('scopes to the full calendar month, inclusive end', () => {
    expect(drillDownHref('2026-07-01', 'month')).toBe('/admin/orders?from=2026-07-01&to=2026-07-31');
  });

  it('gets the inclusive end right across a month-length boundary (Feb)', () => {
    expect(drillDownHref('2026-02-01', 'month')).toBe('/admin/orders?from=2026-02-01&to=2026-02-28');
  });

  it('gets the inclusive end right across a year boundary (December)', () => {
    expect(drillDownHref('2026-12-01', 'month')).toBe('/admin/orders?from=2026-12-01&to=2026-12-31');
  });
});
