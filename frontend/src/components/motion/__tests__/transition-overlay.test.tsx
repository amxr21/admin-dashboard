import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, act, waitFor } from '@/test/render';
import { TransitionOverlay } from '../transition-overlay';

/**
 * The overlay is what makes a pending navigation visible. Without it,
 * `startTransition` leaves the old page on screen doing nothing and the change
 * reads as a freeze followed by a snap.
 */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance past the anti-flash delay. */
function advancePastDelay() {
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe('TransitionOverlay', () => {
  it('renders nothing when inactive', () => {
    render(<TransitionOverlay active={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays hidden for a fast transition', () => {
    // Below the threshold it would flash and read as a glitch. Most warm-cache
    // navigations land here, so the fast path must stay clean.
    render(<TransitionOverlay active />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears once a transition runs long enough to notice', () => {
    render(<TransitionOverlay active />);
    advancePastDelay();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('announces politely rather than silently', () => {
    // A screen-reader user gets no page-change cue at all otherwise.
    render(<TransitionOverlay active />);
    advancePastDelay();

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a default label', () => {
    render(<TransitionOverlay active />);
    advancePastDelay();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('prefers a supplied label', () => {
    render(<TransitionOverlay active label="Switching to العربية" />);
    advancePastDelay();

    expect(screen.getByText('Switching to العربية')).toBeInTheDocument();
  });

  it('fades out, then disappears, when the transition completes', async () => {
    // A real exit fade now, not a hard cut — see the component's comment on
    // why: an instant disappearance left a gap before the new page's own
    // fade-in started, which read as a stutter rather than one transition.
    //
    // Real timers for this one: the exit is a GSAP tween completing via
    // `onComplete`, which GSAP drives off `requestAnimationFrame` — fake
    // timers here don't tick that, so advancing them can't complete it.
    const { rerender } = render(<TransitionOverlay active />);
    advancePastDelay();
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<TransitionOverlay active={false} />);

    // Still present the instant navigation completes — mid fade-out, not
    // yet removed.
    expect(screen.getByRole('status')).toBeInTheDocument();

    vi.useRealTimers();
    await waitFor(
      () => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it('cancels a pending show if the transition finishes first', () => {
    // Without clearing the timer, a fast transition would pop the overlay open
    // AFTER the new page had already rendered.
    const { rerender } = render(<TransitionOverlay active />);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender(<TransitionOverlay active={false} />);
    advancePastDelay();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders in Arabic', () => {
    render(<TransitionOverlay active />, { locale: 'ar' });
    advancePastDelay();

    expect(screen.getByText('جارٍ التحميل…')).toBeInTheDocument();
  });
});
