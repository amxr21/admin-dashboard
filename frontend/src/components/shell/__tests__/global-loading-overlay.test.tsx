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

  /**
   * The overlay is a COMPACT ROW, not the shared `LoadingState`.
   *
   * `LoadingState` carries `min-h-48` and stacks its spinner above its label —
   * right for a panel filling a page, wrong for a floating overlay saying one
   * short word. It is used by 32 other surfaces, so the fix was the caller
   * changing, and the obvious-looking "simplification" later is to reach back
   * for the shared component. These assertions fail when that happens.
   *
   * jsdom computes no layout, so this checks the STRUCTURE that produces the
   * compact shape, not pixels. The visual result still needs a real browser —
   * this project has been bitten before by classes that generated zero CSS
   * while every test stayed green.
   */
  function showOverlay() {
    vi.useFakeTimers();
    render(<GlobalLoadingOverlay />);
    act(() => void beginLoadingActivity());
    act(() => vi.advanceTimersByTime(120));
    return screen.getByRole('status');
  }

  it('lays the spinner beside the label, not stacked above it', () => {
    const row = showOverlay();

    expect(row).toHaveClass('flex', 'items-center');
    // `flex-col` is what `LoadingState` uses; its presence here would mean the
    // tall treatment came back.
    expect(row.className).not.toContain('flex-col');
    expect(row.className).not.toContain('min-h-48');
  });

  it('keeps the spinner, and lets it stop for reduced motion', () => {
    const row = showOverlay();
    const spinner = row.querySelector('svg');

    expect(spinner).not.toBeNull();
    // Decorative: the adjacent text is what a screen reader announces.
    expect(spinner).toHaveAttribute('aria-hidden');
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('constrains its width so a long label cannot overflow a phone', () => {
    const row = showOverlay();

    expect(row.className).toContain('max-w-');
    expect(row.querySelector('span')?.className).toContain('truncate');
  });

  it('uses logical padding, so RTL is not mirrored wrongly', () => {
    // `ps`/`pe`, never `pl`/`pr` — the row is asymmetric (tighter beside the
    // spinner), and physical padding would put the tight side on the wrong
    // edge in Arabic.
    const row = showOverlay();

    expect(row.className).toMatch(/\bps-\d/);
    expect(row.className).toMatch(/\bpe-\d/);
    expect(row.className).not.toMatch(/\bpl-\d/);
    expect(row.className).not.toMatch(/\bpr-\d/);
  });
});
