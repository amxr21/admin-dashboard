import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { Timestamp } from '../timestamp';

/**
 * Every timestamp in the app: a relative label, the absolute value on hover,
 * and — because "relative" is a claim about the current moment — a label
 * that keeps itself honest as time passes without the parent re-rendering it.
 *
 * Fake timers are scoped PER describe block rather than globally. Mixing
 * `vi.useFakeTimers()` with a mid-test escape to `vi.useRealTimers()` (which
 * the hover cases need, since userEvent's pointer interactions don't reliably
 * cooperate with an advanced fake clock) leaves the fake system time only
 * partially torn down for whichever test runs next — real timers resume
 * against the ACTUAL wall clock while a fixture still assumes a fixed
 * "now" of 2026-08-08, silently changing what "2 hours ago" resolves to.
 */

describe('the relative label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a recent past time as relative', () => {
    render(<Timestamp value="2026-08-08T10:00:00.000Z" />);
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
  });

  it('renders a future time as relative too', () => {
    // Access-expiry and reset-token deadlines are future timestamps — the
    // component isn't "time ago", it's "time relative to now" either way.
    render(<Timestamp value="2026-08-08T14:00:00.000Z" />);
    expect(screen.getByText('in 2 hours')).toBeInTheDocument();
  });

  it('accepts a Date as well as an ISO string', () => {
    render(<Timestamp value={new Date('2026-08-08T10:00:00.000Z')} />);
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
  });

  it('renders a dash for an unparsable value rather than "Invalid Date"', () => {
    render(<Timestamp value="not-a-real-date" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
  });
});

describe('the absolute value on hover', () => {
  // Real timers throughout — no fake-clock fixture to disturb here, and
  // Radix's Tooltip/userEvent interaction is the thing actually under test.
  it('shows the full date and time in the tooltip, not in the label itself', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    // Constructed relative to the REAL clock so the label is deterministic
    // regardless of when the suite happens to run.
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    render(<Timestamp value={twoHoursAgo} />);

    const label = screen.getByText('2 hours ago');
    expect(label).not.toHaveTextContent(/\d{4}/);

    await user.hover(label);

    expect(await screen.findByText('UTC')).toBeInTheDocument();
  });
});

describe('staying current', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the label on its own once enough time has passed', async () => {
    // 90s before "now" rounds to "1 minute ago" on mount.
    render(<Timestamp value="2026-08-08T11:58:30.000Z" />);
    expect(screen.getByText('1 minute ago')).toBeInTheDocument();

    // Advanced in a LOOP, one `act` per step, matching the component's own
    // ~60s re-arm cadence at this age. A single large advance only flushes
    // the FIRST scheduled callback — the effect that re-arms the next timer
    // runs on React's next render pass, which a single `act` block doesn't
    // re-enter, so later callbacks never get a chance to fire. Stepping
    // through what the component itself would experience avoids relying on
    // that internal scheduling detail.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }

    expect(screen.getByText('6 minutes ago')).toBeInTheDocument();
  });

  it('schedules a coarser recheck for an old timestamp rather than a 1s tick', async () => {
    render(<Timestamp value="2020-01-01T00:00:00.000Z" />);
    expect(screen.getByText('7 years ago')).toBeInTheDocument();

    // If this were still on a 1-second cadence, a handful of short advances
    // would already have re-rendered and this assertion would be moot by
    // construction. Five seconds changes nothing for a multi-year-old value.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText('7 years ago')).toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders the relative phrase as normal RTL prose, not force-ltr', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));

    render(<Timestamp value="2026-08-08T10:00:00.000Z" />, { locale: 'ar' });

    // "قبل ساعتين" — "two hours ago", Arabic's dual form.
    const label = screen.getByText('قبل ساعتين');
    expect(label).not.toHaveClass('force-ltr');

    vi.useRealTimers();
  });

  it('still forces LTR on the absolute value inside the tooltip', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    render(<Timestamp value={twoHoursAgo} />, { locale: 'ar' });

    await user.hover(screen.getByText('قبل ساعتين'));

    const absolute = await screen.findByText(/\d{4}/);
    expect(absolute).toHaveClass('force-ltr');
  });
});
