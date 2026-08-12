import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { DensityToggle } from '../density-toggle';

/**
 * Two buttons, not one switch — both options are visible at once, and the
 * pressed one is communicated via `aria-pressed`, not inferred from an icon.
 */

describe('reflecting the current value', () => {
  it('marks comfortable as pressed when that is the value', () => {
    render(<DensityToggle value="comfortable" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('marks compact as pressed when that is the value', () => {
    render(<DensityToggle value="compact" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('changing the value', () => {
  it('calls onChange with the clicked option', async () => {
    const onChange = vi.fn();
    render(<DensityToggle value="comfortable" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Compact' }));

    expect(onChange).toHaveBeenCalledWith('compact');
  });
});
