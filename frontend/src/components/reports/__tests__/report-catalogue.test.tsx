import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { ReportCatalogue } from '../report-catalogue';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

describe('report catalogue (C3.1)', () => {
  it('links every report to its own page', async () => {
    render(<ReportCatalogue />);

    // `getAllBy`, not `getBy`: a shortlisted report appears in "Start here"
    // AND in its own domain (F4.2). Both point at the same page, which is
    // what this asserts — the duplication is the feature, not a bug.
    for (const link of screen.getAllByRole('link', { name: /revenue overview/i })) {
      expect(link).toHaveAttribute('href', '/admin/reports/overview');
    }
    expect(screen.getByRole('link', { name: /staff activity/i })).toHaveAttribute(
      'href',
      '/admin/reports/staff-activity',
    );
    expect(screen.getAllByRole('link', { name: /revenue by category/i })[0]).toHaveAttribute(
      'href',
      '/admin/reports/category-breakdown',
    );
    expect(screen.getAllByRole('link', { name: /refund rate trend/i })[0]).toHaveAttribute(
      'href',
      '/admin/reports/refund-rate-trend',
    );
    expect(screen.getByRole('link', { name: /inventory turnover/i })).toHaveAttribute(
      'href',
      '/admin/reports/inventory-turnover',
    );
  });

  it('groups reports under domain headings', () => {
    render(<ReportCatalogue />);

    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Returns' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Staff' })).toBeInTheDocument();
  });

  it('offers a "Start here" shortlist ahead of the full grouped list', () => {
    // F4.2 — 26 cards of identical weight and no entry point is close to
    // having none. The shortlist is the thing that makes the rest browsable.
    render(<ReportCatalogue />);

    expect(screen.getByRole('heading', { name: /start here/i })).toBeInTheDocument();
  });

  it('lists every shortlisted report in its own domain too, so browsing finds no gap', () => {
    // The shortlist holds POINTERS, not copies. A report promoted to the top
    // and quietly removed from Sales/Inventory would be missing for anyone
    // who looks by category — so each shortlisted title appears TWICE.
    render(<ReportCatalogue />);

    for (const name of [/revenue overview/i, /product margin/i, /low stock snapshot/i]) {
      expect(screen.getAllByRole('link', { name }).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not show a "last run" timestamp — no scheduling infra exists to honestly report one', () => {
    render(<ReportCatalogue />);

    expect(screen.queryByText(/last run/i)).not.toBeInTheDocument();
  });
});
