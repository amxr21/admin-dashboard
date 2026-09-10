import { act, render, screen } from '@/test/render';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { beginLoadingActivity } from '@/lib/loading-activity';
import { GlobalLoadingOverlay } from '../global-loading-overlay';

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin' }));

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalLoadingOverlay', () => {
  it('avoids a flash for fast work and covers delayed work until it finishes', () => {
    vi.useFakeTimers();
    render(<GlobalLoadingOverlay />);

    let finish: () => void = () => undefined;
    act(() => { finish = beginLoadingActivity(); });
    act(() => vi.advanceTimersByTime(119));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    act(() => finish());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
