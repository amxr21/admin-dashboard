import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MotionProvider, useMotion } from '../motion-provider';
import { gsap } from '@/lib/gsap';
import { mockMatchMedia, type MatchMediaController } from '@/test/match-media';

/**
 * The master motion switch. The timeScale assertions are the important ones:
 * getting that value wrong is an accessibility bug that hides content, not a
 * cosmetic issue. See the long note in motion-provider.tsx.
 */

let media: MatchMediaController | null = null;

beforeEach(() => {
  window.localStorage.clear();
  gsap.globalTimeline.timeScale(1);
});

afterEach(() => {
  media?.restore();
  media = null;
});

function Probe() {
  const { motionEnabled, setMotionEnabled } = useMotion();
  return (
    <div>
      <span data-testid="enabled">{String(motionEnabled)}</span>
      <button onClick={() => setMotionEnabled(!motionEnabled)}>toggle</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <MotionProvider>
      <Probe />
    </MotionProvider>,
  );
}

describe('MotionProvider', () => {
  it('enables motion when the user has no preference', () => {
    media = mockMatchMedia(false);

    renderProvider();

    expect(screen.getByTestId('enabled')).toHaveTextContent('true');
  });

  it('disables motion when the user prefers reduced motion', () => {
    media = mockMatchMedia(true);

    renderProvider();

    expect(screen.getByTestId('enabled')).toHaveTextContent('false');
  });

  it('NEVER freezes the global timeline at zero', () => {
    // THE critical assertion. timeScale(0) freezes tweens where they are, so an
    // element fading in from opacity 0 stays invisible permanently — the users
    // who need reduced motion get missing content. Reduced motion must mean
    // "arrive instantly", which is a HIGH timeScale.
    media = mockMatchMedia(true);

    renderProvider();

    const scale = gsap.globalTimeline.timeScale();
    expect(scale).not.toBe(0);
    expect(scale).toBeGreaterThan(1);
  });

  it('runs the timeline at normal speed when motion is enabled', () => {
    media = mockMatchMedia(false);

    renderProvider();

    expect(gsap.globalTimeline.timeScale()).toBe(1);
  });

  it('lets the user override the OS preference', async () => {
    // Someone who set reduced motion system-wide may still want motion in a
    // tool they use all day — and vice versa.
    media = mockMatchMedia(true);
    const user = userEvent.setup();

    renderProvider();
    expect(screen.getByTestId('enabled')).toHaveTextContent('false');

    await user.click(screen.getByRole('button', { name: 'toggle' }));

    expect(screen.getByTestId('enabled')).toHaveTextContent('true');
  });

  it('persists an explicit choice', async () => {
    // An admin tool that forgets this on every navigation is worse than not
    // offering the toggle at all.
    media = mockMatchMedia(false);
    const user = userEvent.setup();

    renderProvider();
    await user.click(screen.getByRole('button', { name: 'toggle' }));

    expect(window.localStorage.getItem('admin-dashboard:motion-enabled')).toBe('false');
  });

  it('restores a stored choice over the OS preference', () => {
    // Stored preference wins in BOTH directions, not just when it disables.
    window.localStorage.setItem('admin-dashboard:motion-enabled', 'true');
    media = mockMatchMedia(true);

    renderProvider();

    expect(screen.getByTestId('enabled')).toHaveTextContent('true');
  });

  it('follows OS changes only while the user has not overridden', () => {
    media = mockMatchMedia(false);

    renderProvider();
    expect(screen.getByTestId('enabled')).toHaveTextContent('true');

    act(() => media?.emit(true));

    expect(screen.getByTestId('enabled')).toHaveTextContent('false');
  });

  it('ignores OS changes after an explicit override', async () => {
    media = mockMatchMedia(false);
    const user = userEvent.setup();

    renderProvider();
    // Explicitly turn motion off.
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('enabled')).toHaveTextContent('false');

    // OS now says "no preference" — the explicit choice must still win.
    act(() => media?.emit(false));

    expect(screen.getByTestId('enabled')).toHaveTextContent('false');
  });

  it('does not throw when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API
    delete window.matchMedia;

    expect(() => renderProvider()).not.toThrow();

    window.matchMedia = original;
  });
});
