import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { NavLabelHeading } from '../nav-label-heading';

/**
 * The heading each relabelable page (`orders`, `staff`, `delivery`, ...)
 * renders in place of a raw `<h1>{t('title')}</h1>` — prefers a business's
 * own override (Settings -> "Staff page name" etc.) over the translated
 * default the page passes in.
 */

const navLabels = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock('@/components/providers/settings-provider', () => ({
  useAppSettings: () => ({ navLabels: navLabels.current }),
}));

beforeEach(() => {
  navLabels.current = {};
});

describe('NavLabelHeading', () => {
  it('renders the default title when nothing is overridden', () => {
    render(<NavLabelHeading labelKey="staff" defaultTitle="Staff" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Staff' })).toBeInTheDocument();
  });

  it('renders the override in place of the default title', () => {
    navLabels.current = { staff: 'Baristas' };
    render(<NavLabelHeading labelKey="staff" defaultTitle="Staff" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Baristas' })).toBeInTheDocument();
    expect(screen.queryByText('Staff')).not.toBeInTheDocument();
  });

  it('is keyed by labelKey, not by the default title text', () => {
    // A different page's override must never leak into this one.
    navLabels.current = { orders: 'Tickets' };
    render(<NavLabelHeading labelKey="staff" defaultTitle="Staff" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Staff' })).toBeInTheDocument();
  });
});
