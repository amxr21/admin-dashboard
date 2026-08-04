import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { OnboardingWelcome } from '../onboarding-welcome';

/**
 * A single dismissible first-run card, gated on a localStorage flag that is
 * per-browser (not per-account) — see useOnboardingWelcome.ts. The property
 * worth pinning: it shows once when the flag is absent, and dismissing it
 * writes the flag so a remount (a fresh page load, in the real app) does not
 * reshow it.
 *
 * Assertions target the SUBTITLE, not the title — the Sheet primitive also
 * renders an sr-only `<h2>` matching the title (for `aria-labelledby`), so a
 * title match is ambiguous between two real elements; the subtitle appears
 * exactly once.
 */

const STORAGE_KEY = 'admin-dashboard:onboarding-welcome-seen';
const SUBTITLE = /easy to miss on a first look/i;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('first-run visibility', () => {
  it('shows the welcome card when no "seen" flag is stored', async () => {
    render(<OnboardingWelcome />);

    expect(await screen.findByText(SUBTITLE)).toBeInTheDocument();
  });

  it('does not show once the "seen" flag is already stored', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');

    render(<OnboardingWelcome />);

    // Give the mount-effect a tick to run, then confirm it never appears.
    await waitFor(() => {
      expect(screen.queryByText(SUBTITLE)).not.toBeInTheDocument();
    });
  });
});

describe('dismissing it', () => {
  it('hides the card and persists the flag so a remount does not reshow it', async () => {
    const { unmount } = render(<OnboardingWelcome />);

    await screen.findByText(SUBTITLE);
    await userEvent.click(screen.getByRole('button', { name: /got it/i }));

    await waitFor(() => {
      expect(screen.queryByText(SUBTITLE)).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');

    unmount();
    render(<OnboardingWelcome />);

    await waitFor(() => {
      expect(screen.queryByText(SUBTITLE)).not.toBeInTheDocument();
    });
  });
});

describe('localisation', () => {
  it('renders in Arabic', async () => {
    render(<OnboardingWelcome />, { locale: 'ar' });

    expect(await screen.findByText(/الأمور التي قد تفوتك/)).toBeInTheDocument();
  });
});
