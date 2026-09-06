import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/render';
import { NavPendingIndicator } from '../nav-pending-indicator';

/**
 * The "your click registered" spinner (F7.4).
 *
 * `PageTransition` fades the NEW page in once it arrives and does nothing
 * during the gap before that, so a click on a route that has to fetch used to
 * produce no feedback at all.
 *
 * These assertions are about the two states and the failure mode that made
 * `useLinkStatus` the right hook: it is scoped to the enclosing `<Link>` and
 * cleared by the router, so the indicator cannot outlive the navigation it
 * describes — unlike an `onClick` + local-state version, which stays spinning
 * forever if a navigation is cancelled.
 */

const linkStatus = vi.hoisted(() => ({ pending: false }));
vi.mock('next/link', () => ({
  useLinkStatus: () => linkStatus,
}));

beforeEach(() => {
  linkStatus.pending = false;
});

describe('NavPendingIndicator', () => {
  it('renders nothing while no navigation is pending', () => {
    const { container } = render(<NavPendingIndicator />);

    // Not merely hidden — absent. An always-mounted spinner toggled with CSS
    // would still be read by anything walking the DOM.
    expect(container.firstChild).toBeNull();
  });

  it('renders a spinner while a navigation is pending', () => {
    linkStatus.pending = true;
    const { container } = render(<NavPendingIndicator />);

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass('animate-spin');
  });

  it('is hidden from assistive tech', () => {
    // The spinner is decoration: the navigation itself is what a screen
    // reader announces, and a spinning icon adds nothing but noise.
    linkStatus.pending = true;
    const { container } = render(<NavPendingIndicator />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('delays its appearance so a prefetched route never flashes', () => {
    // A route that resolves in one frame would otherwise show a spinner that
    // appears and vanishes instantly, which reads as a glitch rather than
    // feedback. The delay is CSS, so it costs no timer and no re-render.
    linkStatus.pending = true;
    const { container } = render(<NavPendingIndicator />);

    expect(container.querySelector('svg')).toHaveClass('motion-safe:delay-150');
  });

  it('passes through a caller-supplied class for the collapsed rail', () => {
    linkStatus.pending = true;
    const { container } = render(<NavPendingIndicator className="absolute bottom-0.5" />);

    expect(container.querySelector('svg')).toHaveClass('absolute');
  });
});
