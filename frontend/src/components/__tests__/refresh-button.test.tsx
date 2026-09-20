import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/render';
import { RefreshButton } from '@/components/refresh-button';

describe('RefreshButton', () => {
  it('runs the supplied refresh action', async () => {
    const onRefresh = vi.fn();
    render(<RefreshButton onRefresh={onRefresh} />);

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('is disabled and exposes its busy state while refreshing', () => {
    render(<RefreshButton onRefresh={vi.fn()} isLoading />);

    const button = screen.getByRole('button', { name: /refresh/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg')).toHaveClass('motion-reduce:animate-none');
  });

  it('shows the last successful update time', () => {
    render(<RefreshButton onRefresh={vi.fn()} lastUpdated={new Date('2026-09-20T10:15:00Z')} />);

    expect(screen.getByRole('button', { name: /updated/i })).toBeInTheDocument();
  });
});
