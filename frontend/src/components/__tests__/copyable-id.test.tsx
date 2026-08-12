import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { CopyableId } from '../copyable-id';

/**
 * Identifiers are read down a column and pasted elsewhere.
 *
 * The two behaviours worth pinning: the value that reaches the clipboard is
 * the RAW identifier (not the display label), and the control degrades to
 * plain text where the clipboard API doesn't exist — a button that silently
 * does nothing is worse than no button.
 */

const writeText = vi.fn();

function withClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  withClipboard({ writeText });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('copying', () => {
  it('copies the value', async () => {
    render(<CopyableId value="ORD-1024" />);

    await userEvent.click(screen.getByRole('button', { name: /ORD-1024/ }));

    expect(writeText).toHaveBeenCalledWith('ORD-1024');
  });

  it('copies the raw value, not the display label', async () => {
    // The order table shows "#1024" but the useful thing to paste is the full
    // identifier the API and the search box both expect.
    render(<CopyableId value="ORD-1024" label="#1024" />);

    await userEvent.click(screen.getByRole('button', { name: /ORD-1024/ }));

    expect(writeText).toHaveBeenCalledWith('ORD-1024');
    expect(screen.getByText('#1024')).toBeInTheDocument();
  });

  it('confirms the copy, then reverts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<CopyableId value="SKU-9" />);

    await user.click(screen.getByRole('button', { name: /SKU-9/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument(),
    );

    // Reverts on its own — a permanent tick would claim the clipboard still
    // holds this value long after it doesn't.
    vi.advanceTimersByTime(2100);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument(),
    );
  });

  it('stays quiet when the clipboard refuses', async () => {
    // Permission can be denied even where the API exists.
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyableId value="ORD-1" />);

    await userEvent.click(screen.getByRole('button', { name: /ORD-1/ }));

    // Still readable, no thrown error, no "Copied" claim.
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Copied/ })).not.toBeInTheDocument(),
    );
  });
});

describe('without a clipboard', () => {
  it('renders plain text rather than a dead button', () => {
    // `navigator.clipboard` is undefined on insecure origins.
    withClipboard(undefined);

    render(<CopyableId value="ORD-7" />);

    expect(screen.getByText('ORD-7')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('presentation', () => {
  it('forces LTR so a code cannot reorder in Arabic', () => {
    // "ORD-1024" rendered RTL can display as "1024-ORD" — a different string
    // to anyone copying it by hand.
    render(<CopyableId value="ORD-1024" />, { locale: 'ar' });

    expect(screen.getByText('ORD-1024')).toHaveClass('force-ltr');
  });
});
