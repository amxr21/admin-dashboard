import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { useReducedMotion } from '../useReducedMotion';
import { mockMatchMedia, type MatchMediaController } from '@/test/match-media';

/**
 * The hook that decides whether users with vestibular disorders get moving
 * content. Worth testing properly.
 */

let media: MatchMediaController | null = null;

afterEach(() => {
  media?.restore();
  media = null;
});

function Probe() {
  const reduced = useReducedMotion();
  return <span data-testid="value">{String(reduced)}</span>;
}

describe('useReducedMotion', () => {
  it('reports true when the user prefers reduced motion', () => {
    media = mockMatchMedia(true);

    render(<Probe />);

    expect(screen.getByTestId('value')).toHaveTextContent('true');
  });

  it('reports false when the user has no preference', () => {
    media = mockMatchMedia(false);

    render(<Probe />);

    expect(screen.getByTestId('value')).toHaveTextContent('false');
  });

  it('reacts to the preference changing mid-session', () => {
    // Users do toggle this in OS settings while an app is open, and a dashboard
    // stays open for hours.
    media = mockMatchMedia(false);

    render(<Probe />);
    expect(screen.getByTestId('value')).toHaveTextContent('false');

    act(() => media?.emit(true));

    expect(screen.getByTestId('value')).toHaveTextContent('true');
  });

  it('does not throw when matchMedia is unavailable', () => {
    // Older browsers, and any non-DOM rendering path. Absence of the API must
    // degrade to "no preference", never crash the page.
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API to simulate its absence
    delete window.matchMedia;

    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId('value')).toHaveTextContent('false');

    window.matchMedia = original;
  });
});
