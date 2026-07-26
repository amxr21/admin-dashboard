import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { DatePicker } from '../date-picker';

/**
 * The date field.
 *
 * The bug worth guarding is the quiet one: `toISOString()` converts to UTC
 * first, so west of Greenwich picking the 20th saves the 19th. It fails for
 * some users and not others, never throws, and only shows up when someone
 * compares a saved record against what they remember choosing.
 */

function renderPicker(value = '', props: Partial<{ required: boolean }> = {}) {
  const onChange = vi.fn();
  const result = render(<DatePicker value={value} onChange={onChange} {...props} />);
  return { ...result, onChange };
}

describe('displaying the value', () => {
  it('invites a choice when empty', () => {
    renderPicker();

    expect(screen.getByRole('button', { name: /pick a date/i })).toBeInTheDocument();
  });

  it('shows the selected date in a readable form', () => {
    renderPicker('2026-03-20');

    expect(screen.getByRole('button', { name: /March 20, 2026/i })).toBeInTheDocument();
  });
});

describe('the value never shifts by a day', () => {
  it('emits exactly the day that was clicked', async () => {
    // The whole point. A UTC round-trip would emit 2026-03-19 here for anyone
    // in a negative-offset timezone.
    const { onChange } = renderPicker('2026-03-05');

    await userEvent.click(screen.getByRole('button', { name: /March 5, 2026/i }));
    // Targeted by visible text: the accessible name is the full formatted
    // date, so matching on "20" alone would also match the month grid label.
    await userEvent.click(await screen.findByText('20', { selector: 'button' }));

    expect(onChange).toHaveBeenCalledWith('2026-03-20');
  });

  it('opens on the month of the current value rather than today', async () => {
    // Landing on today would make editing an old record a paging exercise.
    renderPicker('2026-03-05');

    await userEvent.click(screen.getByRole('button', { name: /March 5, 2026/i }));

    expect(await screen.findByText(/March 2026/i)).toBeInTheDocument();
  });
});

describe('clearing', () => {
  it('empties an optional date', async () => {
    const { onChange } = renderPicker('2026-03-20');

    await userEvent.click(screen.getByRole('button', { name: /clear date/i }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('offers no clear control on a required date', () => {
    // There is nothing valid to clear to, so offering it would be offering a
    // state the server rejects.
    renderPicker('2026-03-20', { required: true });

    expect(screen.queryByRole('button', { name: /clear date/i })).not.toBeInTheDocument();
  });
});

describe('localisation', () => {
  it('renders Arabic month names but Western digits', async () => {
    /**
     * Intl would render 2026 as ٢٠٢٦ in Arabic by default. Every other figure
     * in this app is pinned to Latin digits, so a calendar using Arabic-Indic
     * ones would be the only screen mixing the two.
     */
    const onChange = vi.fn();
    render(<DatePicker value="2026-03-20" onChange={onChange} />, { locale: 'ar' });

    const trigger = screen.getByRole('button', { name: /مارس/ });
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toMatch(/20/);
    expect(trigger.textContent).toMatch(/2026/);
    // No Arabic-Indic digits anywhere in the label.
    expect(trigger.textContent).not.toMatch(/[٠-٩]/);
  });
});
