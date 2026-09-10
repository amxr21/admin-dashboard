import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion-provider';
import { render, screen } from '@/test/render';
import { PersonalSettingsPanel } from '../personal-settings-panel';

describe('PersonalSettingsPanel motion preference', () => {
  it('lets the user disable motion and announces the current action', async () => {
    const user = userEvent.setup();

    render(
      <MotionProvider>
        <PersonalSettingsPanel />
      </MotionProvider>,
    );

    const button = await screen.findByRole('button', { name: 'Disable animations' });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await user.click(button);

    expect(screen.getByRole('button', { name: 'Enable animations' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(window.localStorage.getItem('admin-dashboard:motion-enabled')).toBe('false');
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced');
  });
});
