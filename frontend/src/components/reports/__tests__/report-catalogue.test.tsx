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

    expect(screen.getByRole('link', { name: /revenue overview/i })).toHaveAttribute(
      'href',
      '/admin/reports/overview',
    );
    expect(screen.getByRole('link', { name: /staff activity/i })).toHaveAttribute(
      'href',
      '/admin/reports/staff-activity',
    );
    expect(screen.getByRole('link', { name: /revenue by category/i })).toHaveAttribute(
      'href',
      '/admin/reports/category-breakdown',
    );
    expect(screen.getByRole('link', { name: /refund rate trend/i })).toHaveAttribute(
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

  it('does not show a "last run" timestamp — no scheduling infra exists to honestly report one', () => {
    render(<ReportCatalogue />);

    expect(screen.queryByText(/last run/i)).not.toBeInTheDocument();
  });
});
