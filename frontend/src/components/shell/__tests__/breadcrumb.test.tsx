import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { Breadcrumb, BreadcrumbHost, BreadcrumbProvider, useBreadcrumbSegments } from '../breadcrumb';

/**
 * C4.4 — same opt-in-context shape as `page-title.tsx`: a detail page hands
 * its trail up via `<Breadcrumb>`, `AppShell` renders it via `BreadcrumbHost`.
 * The property worth pinning hardest: unmounting clears the trail, so
 * navigating from a detail page (which registered one) to a page that never
 * opts in doesn't leave the PREVIOUS page's trail showing.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

function Consumer() {
  const segments = useBreadcrumbSegments();
  return <div data-testid="consumer">{segments ? JSON.stringify(segments) : 'none'}</div>;
}

describe('Breadcrumb registers a trail with the provider', () => {
  it('starts with no trail', () => {
    render(
      <BreadcrumbProvider>
        <Consumer />
      </BreadcrumbProvider>,
    );

    expect(screen.getByTestId('consumer')).toHaveTextContent('none');
  });

  it('registers the trail an opted-in page renders', () => {
    render(
      <BreadcrumbProvider>
        <Breadcrumb segments={[{ label: 'Orders', href: '/admin/orders' }, { label: 'ORD-1024' }]} />
        <Consumer />
      </BreadcrumbProvider>,
    );

    expect(screen.getByTestId('consumer')).toHaveTextContent('Orders');
    expect(screen.getByTestId('consumer')).toHaveTextContent('ORD-1024');
  });

  it('clears the trail when the registering page unmounts', () => {
    function Page({ showBreadcrumb }: { showBreadcrumb: boolean }) {
      return (
        <>
          {showBreadcrumb ? <Breadcrumb segments={[{ label: 'ORD-1024' }]} /> : null}
          <Consumer />
        </>
      );
    }

    const { rerender } = render(
      <BreadcrumbProvider>
        <Page showBreadcrumb />
      </BreadcrumbProvider>,
    );
    expect(screen.getByTestId('consumer')).toHaveTextContent('ORD-1024');

    // Simulates navigating away to a page that never registers a trail —
    // the PREVIOUS page's trail must not survive that navigation.
    rerender(
      <BreadcrumbProvider>
        <Page showBreadcrumb={false} />
      </BreadcrumbProvider>,
    );
    expect(screen.getByTestId('consumer')).toHaveTextContent('none');
  });

  it('renders nothing itself — it only writes to context', () => {
    const { container } = render(
      <BreadcrumbProvider>
        <Breadcrumb segments={[{ label: 'ORD-1024' }]} />
      </BreadcrumbProvider>,
    );

    expect(container.textContent).toBe('');
  });
});

describe('BreadcrumbHost renders the trail', () => {
  it('links every segment except the last', () => {
    render(
      <BreadcrumbHost segments={[{ label: 'Orders', href: '/admin/orders' }, { label: 'ORD-1024' }]} />,
    );

    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders');
    expect(screen.queryByRole('link', { name: 'ORD-1024' })).not.toBeInTheDocument();
  });

  it('marks the last segment as the current page for assistive tech', () => {
    render(
      <BreadcrumbHost segments={[{ label: 'Orders', href: '/admin/orders' }, { label: 'ORD-1024' }]} />,
    );

    expect(screen.getByText('ORD-1024')).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark a linked (non-last) segment as current', () => {
    render(
      <BreadcrumbHost segments={[{ label: 'Orders', href: '/admin/orders' }, { label: 'ORD-1024' }]} />,
    );

    expect(screen.getByRole('link', { name: 'Orders' })).not.toHaveAttribute('aria-current');
  });

  it('renders a single segment with no separator', () => {
    render(<BreadcrumbHost segments={[{ label: 'ORD-1024' }]} />);

    expect(screen.getByText('ORD-1024')).toBeInTheDocument();
  });
});
