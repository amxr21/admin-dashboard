import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { MetricDefinition } from '@/components/reports/metric-definition';
import { render, screen } from '@/test/render';

/**
 * The affordance that carries F4.1 — "what does this number actually mean?"
 * attached to the number itself.
 *
 * What matters here is not that a tooltip appears (Radix's job) but that the
 * thing is REACHABLE and DISTINGUISHABLE: a keyboard user must be able to get
 * to it, and a screen-reader user must be told which of six identical info
 * buttons on a page they have landed on.
 */
describe('metric definition', () => {
  it('names the metric in its accessible name, not just "more info"', () => {
    render(<MetricDefinition label="Revenue" definition="Excludes canceled orders." />);

    // Six of these on one page all announcing "More information" would be
    // useless — the label is what makes each one identifiable.
    expect(screen.getByRole('button', { name: /revenue/i })).toBeInTheDocument();
  });

  it('is keyboard focusable', async () => {
    const user = userEvent.setup();
    render(<MetricDefinition label="Revenue" definition="Excludes canceled orders." />);

    // A bare <span> with an icon would render identically and be completely
    // unreachable without a mouse — this is the regression worth guarding.
    await user.tab();
    expect(screen.getByRole('button', { name: /revenue/i })).toHaveFocus();
  });

  it('renders as a button that cannot submit a surrounding form', () => {
    render(<MetricDefinition label="Revenue" definition="Excludes canceled orders." />);

    // Some of these sit inside forms; a default-type button would submit.
    expect(screen.getByRole('button', { name: /revenue/i })).toHaveAttribute('type', 'button');
  });
});
