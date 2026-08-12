import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/render';
import { RevenueChart, type RevenuePoint } from '../revenue-chart';

/**
 * The legend that states what each stroke means.
 *
 * Before this, the file's own comment said "the heading names the series, so
 * no legend is needed" — true for one line, but the chart can draw up to
 * three (settled revenue, its dashed in-progress tail, a dashed comparison
 * overlay), and the heading only ever names one of them. What matters here:
 * the legend shows ONLY the entries for series actually on screen, never a
 * swatch for a line that isn't drawn.
 */

const GRANULARITY = 'day';

function points(...revenues: (number | null)[]): RevenuePoint[] {
  const base = new Date();
  base.setDate(base.getDate() - revenues.length);
  return revenues.map((revenue, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), revenue };
  });
}

/**
 * Far enough in the future that its bucket can never have settled, in any
 * timezone the suite happens to run in. `bucketEnd` constructs its Date in
 * LOCAL time from a plain "YYYY-MM-DD" string, so a fixture built from
 * `new Date().toISOString()` (UTC) can land on the wrong side of midnight
 * depending on the runner's offset — this sidesteps that entirely.
 */
const FAR_FUTURE = '2099-01-01';

describe('the single-line case', () => {
  it('renders no legend at all — the heading already names the one series', () => {
    render(<RevenueChart data={points(10, 20, 30)} granularity={GRANULARITY} />);

    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText(/in progress/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/previous period/i)).not.toBeInTheDocument();
  });
});

describe('a comparison overlay', () => {
  it('adds a legend entry naming both series', () => {
    render(
      <RevenueChart
        data={points(10, 20, 30)}
        comparisonData={points(8, 18, 28)}
        granularity={GRANULARITY}
      />,
    );

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Previous period')).toBeInTheDocument();
  });

  it('uses the caller-supplied comparison label over the default', () => {
    render(
      <RevenueChart
        data={points(10, 20, 30)}
        comparisonData={points(8, 18, 28)}
        comparisonLabel="Same period last year"
        granularity={GRANULARITY}
      />,
    );

    expect(screen.getByText('Same period last year')).toBeInTheDocument();
    expect(screen.queryByText('Previous period')).not.toBeInTheDocument();
  });

  it('omits the comparison entry when there is no overlay to explain', () => {
    render(<RevenueChart data={points(10, 20, 30)} granularity={GRANULARITY} />);

    expect(screen.queryByText('Previous period')).not.toBeInTheDocument();
  });
});

describe('an in-progress bucket', () => {
  it('adds a legend entry for the dashed trailing segment', () => {
    const data: RevenuePoint[] = [
      { date: '2020-01-01', revenue: 10 },
      { date: FAR_FUTURE, revenue: 5 },
    ];

    render(<RevenueChart data={data} granularity={GRANULARITY} />);

    expect(screen.getByText('In progress — period not yet complete')).toBeInTheDocument();
  });

  it('omits the in-progress entry when every bucket has already settled', () => {
    const past = new Date('2020-01-01');
    const data: RevenuePoint[] = [
      { date: '2020-01-01', revenue: 10 },
      { date: new Date(past.getTime() + 86_400_000).toISOString().slice(0, 10), revenue: 20 },
    ];

    render(<RevenueChart data={data} granularity={GRANULARITY} />);

    expect(screen.queryByText(/in progress/i)).not.toBeInTheDocument();
  });
});

describe('both at once', () => {
  it('shows all three legend entries together', () => {
    const data: RevenuePoint[] = [
      { date: '2020-01-01', revenue: 10 },
      { date: '2099-01-01', revenue: 5 },
    ];
    const comparison: RevenuePoint[] = [
      { date: '2019-01-01', revenue: 8 },
      { date: '2019-01-02', revenue: 4 },
    ];

    render(
      <RevenueChart data={data} comparisonData={comparison} granularity={GRANULARITY} />,
    );

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('In progress — period not yet complete')).toBeInTheDocument();
    expect(screen.getByText('Previous period')).toBeInTheDocument();
  });
});

describe('drill-down affordance (C1.6)', () => {
  // Recharts renders its interactive surface as SVG sized by a real layout
  // engine (<ResponsiveContainer> reports 0×0 under jsdom and skips drawing
  // the inner <svg> entirely), so neither the cursor-style class nor a
  // simulated click on a specific point can be verified here — the same
  // limitation this file's other tests work around by only ever asserting
  // on the legend text, never the chart's own pixels. What's left provably
  // testable: the prop is genuinely opt-in (an unrelated caller gets no new
  // behaviour) and doesn't break rendering either way.

  it('is opt-in — omitting drillDownEnabled changes nothing about what renders', () => {
    render(<RevenueChart data={points(10, 20, 30)} granularity={GRANULARITY} />);
    expect(screen.queryByText(/click to view/i)).not.toBeInTheDocument();
  });

  it('renders without error when drillDownEnabled is passed', () => {
    expect(() =>
      render(
        <RevenueChart data={points(10, 20, 30)} granularity={GRANULARITY} drillDownEnabled />,
      ),
    ).not.toThrow();
  });
});
