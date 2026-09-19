import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { PasswordInput } from '../password-input';

describe('PasswordInput', () => {
  it('renders a labelled reveal control and toggles only the current field', async () => {
    render(<PasswordInput id="account-password" aria-label="Password" />);

    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });

    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-controls', 'account-password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.querySelector('svg')).toBeInTheDocument();

    await userEvent.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps the reveal control available in Arabic without mirroring the eye icon', () => {
    render(<PasswordInput id="arabic-password" aria-label="كلمة المرور" />, {
      locale: 'ar',
    });

    const toggle = screen.getByRole('button', { name: 'إظهار كلمة المرور' });
    expect(toggle.querySelector('svg')).not.toHaveClass('icon-directional');
  });
});
