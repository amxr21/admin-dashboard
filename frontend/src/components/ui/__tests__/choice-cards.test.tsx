import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { radioArrowStep } from '@/lib/radio-group-keys';
import { ChoiceCards } from '../choice-cards';

const OPTIONS = [
  { value: 'A', label: 'Out of stock' },
  { value: 'B', label: 'Duplicate order' },
  { value: 'C', label: 'Other' },
];

function Controlled({ initial = '', onChange = vi.fn() }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ChoiceCards
      aria-label="Reason"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('radioArrowStep', () => {
  it('maps left/right through the reading direction', () => {
    expect(radioArrowStep('ArrowRight', false)).toBe(1);
    expect(radioArrowStep('ArrowLeft', false)).toBe(-1);
    // In Arabic, "next" is to the left.
    expect(radioArrowStep('ArrowRight', true)).toBe(-1);
    expect(radioArrowStep('ArrowLeft', true)).toBe(1);
  });

  it('keeps up/down direction-free and ignores other keys', () => {
    expect(radioArrowStep('ArrowDown', true)).toBe(1);
    expect(radioArrowStep('ArrowUp', true)).toBe(-1);
    expect(radioArrowStep('Enter', false)).toBeNull();
  });
});

describe('ChoiceCards', () => {
  it('is a radio group with nothing checked until the user picks', () => {
    render(<Controlled />);

    expect(screen.getByRole('radiogroup', { name: 'Reason' })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('keeps the group reachable by keyboard when nothing is picked', () => {
    render(<Controlled />);

    const [first, second] = screen.getAllByRole('radio');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
  });

  it('picks on click', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Duplicate order' }));

    expect(onChange).toHaveBeenCalledWith('B');
    expect(screen.getByRole('radio', { name: 'Duplicate order' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves and selects with the arrow keys, wrapping at the end', async () => {
    render(<Controlled initial="C" />);

    screen.getByRole('radio', { name: 'Other' }).focus();
    await userEvent.keyboard('{ArrowDown}');

    const first = screen.getByRole('radio', { name: 'Out of stock' });
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(first).toHaveFocus();
  });
});
