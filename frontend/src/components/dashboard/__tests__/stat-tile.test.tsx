import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { StatTile } from '../stat-tile';

/**
 * The tile encodes JUDGEMENT (is this good?) separately from DIRECTION (did it
 * go up?). Conflating them paints a spike in cancellations green, which is
 * worse than showing no delta at all.
 */

// next-intl's navigation module resolves `next/navigation` in a way Vitest
// cannot follow. Same stub every other component test using `Link` uses.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

describe('value rendering', () => {
  it('formats a plain number with locale grouping', () => {
    render(<StatTile labelKey="totalOrders" value={1284} />);
    expect(screen.getByText('1,284')).toBeInTheDocument();
  });

  it('formats currency', () => {
    render(<StatTile labelKey="totalRevenue" value={148920} format="currency" />);
    // AED with Western digits, per the app-wide numeral rule.
    expect(screen.getByText(/148,920/)).toBeInTheDocument();
  });

  it('shows skeletons while loading rather than a zero', () => {
    // Rendering 0 during load states a fact that isn't known yet.
    const { container } = render(
      <StatTile labelKey="totalOrders" value={0} isLoading />,
    );

    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders no delta when none is supplied', () => {
    // Unknown change must not render as 0% — that claims "flat", which is a
    // different statement from "we don't know".
    const { container } = render(<StatTile labelKey="totalOrders" value={10} />);
    expect(container.textContent).not.toContain('%');
  });
});

describe('delta judgement', () => {
  function toneOf(props: Parameters<typeof StatTile>[0]): string {
    const { container } = render(<StatTile {...props} />);
    // The delta line is the only element carrying a success/destructive tone.
    return container.querySelector('p.text-success, p.text-destructive')?.className ?? '';
  }

  it('treats a rise as good for a normal metric', () => {
    expect(toneOf({ labelKey: 'totalOrders', value: 10, deltaPercent: 8 })).toContain(
      'success',
    );
  });

  it('treats a fall as bad for a normal metric', () => {
    expect(toneOf({ labelKey: 'totalOrders', value: 10, deltaPercent: -8 })).toContain(
      'destructive',
    );
  });

  it('treats a rise as BAD for an inverted metric', () => {
    // More pending orders is not an achievement. Without invertDelta this tile
    // would congratulate the user on a growing backlog.
    expect(
      toneOf({ labelKey: 'pendingOrders', value: 37, deltaPercent: 5.6, invertDelta: true }),
    ).toContain('destructive');
  });

  it('treats a fall as GOOD for an inverted metric', () => {
    expect(
      toneOf({ labelKey: 'pendingOrders', value: 37, deltaPercent: -5.6, invertDelta: true }),
    ).toContain('success');
  });

  it('infers inversion from labelKey alone, with no explicit invertDelta prop', () => {
    // The central descriptor (INVERTED_METRICS in stat-tile.tsx) is what
    // must catch this, not caller discipline — a new call site for a known
    // inverted metric can't silently paint a rise green just because it
    // forgot the prop.
    expect(toneOf({ labelKey: 'canceledOrders', value: 4, deltaPercent: 12 })).toContain(
      'destructive',
    );
    expect(toneOf({ labelKey: 'lowStockProducts', value: 11, deltaPercent: 12 })).toContain(
      'destructive',
    );
  });

  it('an explicit invertDelta still overrides the central default', () => {
    // A normal (up-is-good) metric forced to invert via the prop — proves
    // the override path, not just the default path.
    expect(
      toneOf({ labelKey: 'totalOrders', value: 10, deltaPercent: 8, invertDelta: true }),
    ).toContain('destructive');
  });
});

describe('non-colour encoding', () => {
  function arrowDirection(props: Parameters<typeof StatTile>[0]): string | null {
    const { container } = render(<StatTile {...props} />);
    const icon = container.querySelector('p svg');
    return icon?.getAttribute('class') ?? null;
  }

  it('always pairs the delta with an arrow, never colour alone', () => {
    // Red/green is invisible to roughly 1 in 12 men. The arrow is what makes
    // this readable without colour.
    expect(arrowDirection({ labelKey: 'totalOrders', value: 10, deltaPercent: 8 })).toBeTruthy();
  });

  it('points the arrow by DIRECTION, not by judgement', () => {
    // On an inverted metric the arrow and the colour deliberately disagree:
    // the value rose (arrow up) and that is bad (colour red). An arrow that
    // followed the colour would misreport the actual movement.
    const risingBad = render(
      <StatTile labelKey="pendingOrders" value={37} deltaPercent={5.6} invertDelta />,
    );
    const svg = risingBad.container.querySelector('p svg');

    expect(risingBad.container.querySelector('p.text-destructive')).toBeTruthy();
    // lucide sets the icon name as a class.
    expect(svg?.getAttribute('class')).toMatch(/trending-up/);
  });

  it('shows the magnitude unsigned, since the arrow carries the sign', () => {
    render(<StatTile labelKey="totalOrders" value={10} deltaPercent={-8} />);
    expect(screen.getByText('8%')).toBeInTheDocument();
  });
});

describe('icon lookup', () => {
  // The icon is passed as a NAME, not as a component. Passing the component
  // itself breaks the production build ("Functions cannot be passed directly
  // to Client Components") while working fine in dev — so the string API is
  // load-bearing, not a style choice.
  it('renders the icon matching the name', () => {
    const { container } = render(
      <StatTile labelKey="totalCustomers" value={892} icon="customers" />,
    );
    // lucide sets the icon name as a class.
    expect(container.querySelector('svg')?.getAttribute('class')).toMatch(/users/);
  });

  it('renders without an icon when none is named', () => {
    const { container } = render(<StatTile labelKey="totalOrders" value={10} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('drill-down link', () => {
  it('renders as a plain, non-interactive tile when no href is given', () => {
    const { container } = render(<StatTile labelKey="lowStockProducts" value={3} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('div.bg-card')).toBeInTheDocument();
  });

  it('becomes a keyboard-focusable link when href is given', () => {
    render(<StatTile labelKey="lowStockProducts" value={3} href="/admin/inventory?lowStock=true" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/admin/inventory?lowStock=true');
  });

  it('names the destination in the accessible name, not just the metric label', () => {
    render(<StatTile labelKey="lowStockProducts" value={3} href="/admin/inventory?lowStock=true" />);
    // "View {label} details" — must differ from the bare visible label so a
    // screen reader user knows this tile goes somewhere.
    expect(screen.getByRole('link', { name: /low stock/i })).toHaveAccessibleName(
      /view.*low stock/i,
    );
  });
});

describe('localisation', () => {
  it('renders Arabic labels', () => {
    render(<StatTile labelKey="totalRevenue" value={100} />, { locale: 'ar' });
    expect(screen.getByText('إجمالي الإيرادات')).toBeInTheDocument();
  });

  it('keeps Western numerals in Arabic', () => {
    // The app-wide rule: Western digits in BOTH locales, never mixed.
    render(<StatTile labelKey="totalOrders" value={1284} />, { locale: 'ar' });
    expect(screen.getByText('1,284')).toBeInTheDocument();
  });
});
