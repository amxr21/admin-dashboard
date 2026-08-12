import { describe, expect, it } from 'vitest';

import { render } from '@/test/render';
import { Sparkline } from '../sparkline';

/**
 * The KPI tile trend line (C1.3). Recharts renders through SVG that jsdom
 * doesn't lay out pixel-accurately, so these pin STRUCTURE (does a line
 * render at all, does it decline to render for too little data) rather than
 * visual output.
 */

describe('minimum data', () => {
  it('renders nothing for zero points', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a single point — no trend to show', () => {
    const { container } = render(<Sparkline data={[{ date: '2026-07-01', value: 10 }]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chart container for two or more points', () => {
    // Recharts' <ResponsiveContainer> needs a real layout engine to size
    // itself (it reports 0×0 under jsdom and skips drawing the inner <svg>
    // entirely) — same limitation `revenue-chart.test.tsx` works around by
    // never asserting on the <svg> itself. This pins that the component
    // reaches the render call at all for a valid series, not the pixel
    // output jsdom can't produce.
    const { container } = render(
      <Sparkline
        data={[
          { date: '2026-07-01', value: 10 },
          { date: '2026-07-02', value: 20 },
        ]}
      />,
    );
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });
});

describe('gaps', () => {
  it('does not throw on a null value in the middle of the series', () => {
    // A real gap (see fillRevenueGaps/fillOrdersGaps) — connectNulls={false}
    // handles this at the Recharts level; this just pins that passing one
    // through doesn't crash the component.
    expect(() =>
      render(
        <Sparkline
          data={[
            { date: '2026-07-01', value: 10 },
            { date: '2026-07-02', value: null },
            { date: '2026-07-03', value: 15 },
          ]}
        />,
      ),
    ).not.toThrow();
  });
});
